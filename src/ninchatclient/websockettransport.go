package main

import (
	"github.com/gopherjs/gopherjs/js"
)

const (
	maxKeepaliveInterval = Second * 56
	minReceiveTimeout    = Second * 64
)

// WebSocketTransport runs a reconnect loop for a given host.  It doesn't mind
// disconnections, but a failure to connect and establish a session stops the
// loop.
func WebSocketTransport(s *Session, host string) (connWorked, gotOnline bool) {
	var ws *WebSocket

	defer func() {
		if ws != nil {
			ws.Close()
		}
	}()

	connectTimer := NewTimer(-1)
	defer connectTimer.Stop()

	for {
		gotOnline = false
		hostHealthy := false

		s.log("connecting to", host)

		ws = NewWebSocket("wss://" + host + socketPath)
		connectTimer.Reset(JitterDuration(connectTimeout, 0.1))

		select {
		case connected := <-ws.Notify:
			connectTimer.Stop()

			if connected {
				s.log("connected")
				s.connState("connected")

				connWorked = true
				gotOnline, hostHealthy = webSocketHandshake(s, ws)
			} else {
				s.log("connection failed")
			}

		case <-connectTimer.C:
			s.log("connection timeout")

		case <-s.closeNotify:
			connectTimer.Stop()
		}

		goingAway := ws.GoingAway

		ws.Close()
		ws = nil

		if goingAway {
			s.log("disconnected (server is going away)")
		} else {
			s.log("disconnected")
		}

		if !gotOnline || !hostHealthy || s.stopped || goingAway {
			return
		}
	}
}

// webSocketHandshake creates or resumes a session, and runs I/O loops after
// that.
func webSocketHandshake(s *Session, ws *WebSocket) (gotOnline, hostHealthy bool) {
	var header *js.Object

	if s.sessionId == nil {
		s.log("session creation")
		header = s.makeCreateSessionAction()
	} else {
		s.log("session resumption")
		header = s.makeResumeSessionAction(true)
	}

	if err := ws.SendJSON(header); err != nil {
		s.log("send:", err)
	}

	if s.sessionId == nil {
		var header *js.Object

		connected := true
		timer := NewTimer(JitterDuration(sessionCreateTimeout, 0.2))

		for {
			var err error

			if header, err = ws.ReceiveJSON(); err != nil {
				s.log("session creation:", err)
				return
			}
			if header != nil {
				timer.Stop()
				break
			}

			if !connected {
				s.log("disconnected during session creation")
				timer.Stop()
				return
			}

			select {
			case connected = <-ws.Notify:

			case <-timer.C:
				s.log("session creation timeout")
				return
			}
		}

		if !s.handleSessionEvent(header) {
			return
		}

		gotOnline = true
		hostHealthy = true
		s.connActive()
	}

	fail := make(chan bool, 1)
	done := make(chan bool)

	go webSocketSend(s, ws, fail, done)

	gotEvents, hostHealthy := webSocketReceive(s, ws, fail)
	if gotEvents {
		gotOnline = true
	}

	<-done

	return
}

// webSocketSend sends buffered actions and acknowledges events received by
// webSocketReceive.  It makes sure that something is sent to the server every
// now and then.
func webSocketSend(s *Session, ws *WebSocket, fail chan bool, done chan<- bool) {
	defer func() {
		done <- true
	}()

	keeper := NewTimer(JitterDuration(maxKeepaliveInterval, -0.3))
	defer keeper.Stop()

	s.numSent = 0

	for {
		for s.numSent < len(s.sendBuffer) {
			action := s.sendBuffer[s.numSent]

			if action.Payload != nil {
				action.Header.Set("frames", action.Payload.Length())
			}

			if s.receivedEventId != s.ackedEventId {
				action.Header.Set("event_id", s.receivedEventId)

				s.sendEventAck = false
				s.ackedEventId = s.receivedEventId
			}

			err := ws.SendJSON(action.Header)

			action.Header.Delete("frames")
			action.Header.Delete("event_id")

			if err != nil {
				s.log("send:", err)
				fail <- true
				return
			}

			if action.Payload != nil {
				for i := 0; i < action.Payload.Length(); i++ {
					frame := action.Payload.Index(i)

					if action.Header.Get("action").String() == "update_user" {
						if _, ok := frame.Interface().(string); ok {
							base64, err := ParseDataURI(frame)
							if err != nil {
								s.log("send:", err)
								fail <- true
								return
							}

							data, err := Atob(base64)
							if err != nil {
								s.log("send:", err)
								fail <- true
								return
							}

							length := data.Length()
							buffer := NewArrayBuffer(length)
							array := NewUint8Array(buffer)

							for i := 0; i < length; i++ {
								array.SetIndex(i, data.Call("charCodeAt", i))
							}

							frame = buffer
						}
					}

					if err := ws.Send(frame); err != nil {
						s.log("send:", err)
						fail <- true
						return
					}
				}
			}

			if action.Id == 0 {
				s.sendBuffer = append(s.sendBuffer[:s.numSent], s.sendBuffer[s.numSent+1:]...)
			} else {
				s.numSent++
			}

			keeper.Reset(JitterDuration(maxKeepaliveInterval, -0.3))
		}

		if s.sendEventAck && s.receivedEventId != s.ackedEventId {
			action := s.makeResumeSessionAction(false)

			if err := ws.SendJSON(action); err != nil {
				s.log("send:", err)
				fail <- true
				return
			}
		}

		select {
		case sending := <-s.sendNotify:
			if !sending {
				closeSession := map[string]interface{}{
					"action": "close_session",
				}

				if err := ws.SendJSON(closeSession); err != nil {
					s.log("send:", err)
				}

				return
			}

		case <-keeper.C:
			// empty keepalive frame between actions
			if err := ws.Send([]byte{}); err != nil {
				s.log("send:", err)
				fail <- true
				return
			}

			keeper.Reset(JitterDuration(maxKeepaliveInterval, -0.3))

		case <-fail:
			return
		}
	}
}

// webSocketReceive receives events.  It stops if the server doesn't send
// anything for some time.
func webSocketReceive(s *Session, ws *WebSocket, fail chan bool) (gotEvents, hostHealthy bool) {
	var header *js.Object
	var payload *js.Object
	var frames int

	watchdog := NewTimer(JitterDuration(minReceiveTimeout, 0.3))
	defer watchdog.Stop()

	acker := NewTimer(-1)
	defer acker.Stop()

	for {
		var ackNeeded bool

		for {
			if header == nil {
				var err error

				data, err := ws.Receive()
				if err != nil {
					s.log("receive:", err)
					hostHealthy = false
					fail <- true
					return
				}

				if data == nil {
					break
				}

				watchdog.Reset(JitterDuration(minReceiveTimeout, 0.7))
				s.connActive()

				text := StringifyFrame(data)
				if len(text) == 0 {
					// keepalive frame
					continue
				}

				if header, err = ParseJSON(text); err != nil {
					s.log("receive:", err)
					hostHealthy = false
					fail <- true
					return
				}

				payload = NewArray()

				if frames, err = GetEventFrames(header); err != nil {
					s.log("receive:", err)
					hostHealthy = false
					fail <- true
					return
				}
			} else {
				data, err := ws.Receive()
				if err != nil {
					s.log("receive:", err)
					hostHealthy = false
					fail <- true
					return
				}

				if data == nil {
					break
				}

				payload.Call("push", data)
				frames--
			}

			if frames == 0 {
				_, sessionLost, needsAck, ok := s.handleEvent(header, payload)
				if !ok {
					if sessionLost {
						gotEvents = true
					} else {
						hostHealthy = false
					}

					fail <- true
					return
				}

				if needsAck {
					ackNeeded = true
				}

				header = nil
				payload = nil
				frames = 0

				gotEvents = true
				hostHealthy = true
			}

			select {
			case <-s.closeNotify:
				return

			case <-fail:
				return

			default:
				// don't wait
			}
		}

		if ackNeeded && !acker.Active() {
			acker.Reset(JitterDuration(maxEventAckDelay, -0.3))
		}

		select {
		case connected := <-ws.Notify:
			if !connected {
				fail <- true
				return
			}

		case <-watchdog.C:
			s.log("receive timeout")
			fail <- true
			return

		case <-acker.C:
			if !s.sendEventAck && s.ackedEventId != s.receivedEventId {
				s.sendAck()
			}

		case <-s.closeNotify:
			return

		case <-fail:
			return
		}
	}
}
