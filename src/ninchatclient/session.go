package main

import (
	"sort"

	"github.com/gopherjs/gopherjs/js"
)

const (
	discoveryTimeout  = Second * 7
	connectTimeout    = Second * 9
	connectIterations = 2
	maxBackoffDelay   = Second * 60

	sessionCreateTimeout = Second * 13

	maxEventAckDelay  = Second * 7
	maxEventAckWindow = 4096

	sessionSessionEventInvocationName = namespace + ".Session onSessionEvent callback"
	sessionEventInvocationName        = namespace + ".Session onEvent callback"
	sessionConnStateInvocationName    = namespace + ".Session onConnState callback"
	sessionConnActiveInvocationName   = namespace + ".Session onConnActive callback"
	sessionLogInvocationName          = namespace + ".Session onLog callback"
)

var (
	sessionEventAckWindow = JitterUint64(maxEventAckWindow, -0.25)
)

// Transport is an interface implemented by WebSocketTransport and
// LongPollTransport.
type Transport func(s *Session, host string) (connWorked, gotOnline bool)

// Session hides the details of Ninchat API connection management.
type Session struct {
	onSessionEvent *js.Object
	onEvent        *js.Object
	onConnState    *js.Object
	onConnActive   *js.Object
	onLog          *js.Object
	address        string
	forceLongPoll  bool
	sessionParams  map[string]*js.Object
	sessionId      *js.Object

	latestConnState  string
	latestConnActive Time

	lastActionId    uint64
	sendNotify      chan bool
	sendBuffer      []*Action
	numSent         int
	sendEventAck    bool
	receivedEventId uint64
	ackedEventId    uint64

	closeNotify chan bool
	closed      bool
	stopped     bool
}

// NewSession implements the newSession() JavaScript API.
func NewSession() map[string]interface{} {
	s := Session{
		address: defaultAddress,
		stopped: true,
	}

	return map[string]interface{}{
		"onSessionEvent": s.OnSessionEvent,
		"onEvent":        s.OnEvent,
		"onConnState":    s.OnConnState,
		"onConnActive":   s.OnConnActive,
		"onLog":          s.OnLog,
		"setParams":      s.SetParams,
		"setTransport":   s.SetTransport,
		"setAddress":     s.SetAddress,
		"open":           s.Open,
		"close":          s.Close,
		"send":           s.Send,
	}
}

// OnSessionEvent implements the Session.onSessionEvent(function) JavaScript
// API.
func (s *Session) OnSessionEvent(callback *js.Object) {
	s.onSessionEvent = callback
}

// OnEvent implements the Session.onEvent(function) JavaScript API.
func (s *Session) OnEvent(callback *js.Object) {
	s.onEvent = callback
}

// OnConnState implements the Session.onConnState(function|null) JavaScript
// API.
func (s *Session) OnConnState(callback *js.Object) {
	if callback == nil {
		callback = nil
	}

	s.onConnState = callback

	if s.onConnState != nil && s.latestConnState != "" {
		jsInvoke(sessionConnStateInvocationName, s.onConnState, s.latestConnState)
	}
}

// OnConnActive implements the Session.onConnActive(function|null) JavaScript
// API.
func (s *Session) OnConnActive(callback *js.Object) {
	if callback == nil {
		callback = nil
	}

	s.onConnActive = callback

	if s.onConnActive != nil && s.latestConnActive > 0 {
		jsInvoke(sessionConnActiveInvocationName, s.onConnActive, s.latestConnActive)
	}
}

// OnLog implements the Session.onLog(function|null) JavaScript API.
func (s *Session) OnLog(callback *js.Object) {
	if callback == nil {
		callback = nil
	}

	s.onLog = callback
}

// SetParams implements the Session.setParams(object) JavaScript API.
func (s *Session) SetParams(params map[string]*js.Object) {
	if params["message_types"] == nil {
		panic("message_types parameter not defined")
	}

	if sessionId := params["session_id"]; sessionId != nil {
		s.sessionId = sessionId
	}

	delete(params, "session_id")

	s.sessionParams = params

	if s.sendNotify != nil && s.stopped {
		// opened + stopped -> restart
		go s.discover()
	}
}

// SetTransport implements the Session.setTransport(string|null) JavaScript
// API.
func (s *Session) SetTransport(name *js.Object) {
	if name == nil {
		s.forceLongPoll = false
		return
	}

	switch string := name.String(); string {
	case "websocket":
		panic("websocket transport cannot be forced")

	case "longpoll":
		s.forceLongPoll = true

	default:
		panic("unknown transport: " + string)
	}
}

// SetAddress implements the Session.setAddress(string|null) JavaScript API.
func (s *Session) SetAddress(address *js.Object) {
	s.address = GetAddress(address)
}

// Open implements the Session.open() JavaScript API.
func (s *Session) Open() {
	if s.closed {
		panic("session already closed")
	}

	if s.sendNotify != nil {
		panic("session already initialized")
	}

	if s.onSessionEvent == nil {
		panic("onSessionEvent callback not defined")
	}

	if s.onEvent == nil {
		panic("onEvent callback not defined")
	}

	if s.sessionParams == nil {
		panic("session parameters not defined")
	}

	s.sendNotify = make(chan bool, 1)
	s.closeNotify = make(chan bool, 1)
	s.stopped = false

	go s.discover()
}

// Close implements the Session.close() JavaScript API.
func (s *Session) Close() {
	if s.closed {
		return
	}

	for _, action := range s.sendBuffer {
		if action.Deferred != nil {
			action.Deferred.Reject()
		}
	}

	s.sendBuffer = nil
	s.numSent = 0

	s.closed = true
	s.stopped = true

	go func() {
		s.closeNotify <- true
		close(s.sendNotify)
	}()
}

// Send implements the Session.send(object[, array]) JavaScript API.
func (s *Session) Send(header, payload *js.Object) (promise interface{}) {
	if s.sendNotify == nil {
		panic("session not initialized")
	}

	if s.closed {
		panic("session already closed")
	}

	if payload == js.Undefined || payload == nil || payload.Length() == 0 {
		payload = nil
	}

	action := &Action{
		Header:  header,
		Payload: payload,
	}

	if header.Get("action_id") == nil {
		header.Delete("action_id")
	} else {
		s.lastActionId++
		action.Id = s.lastActionId
		header.Set("action_id", action.Id)

		action.Deferred, promise = Defer()
	}

	s.send(action)
	return
}

// send buffers an action.
func (s *Session) send(action *Action) {
	s.sendBuffer = append(s.sendBuffer, action)

	go func() {
		select {
		case s.sendNotify <- true:
		default:
		}
	}()

	return
}

// sendAck indicates that this is a good time to acknowledge received events.
func (s *Session) sendAck() {
	s.sendEventAck = true

	go func() {
		select {
		case s.sendNotify <- true:
		default:
		}
	}()
}

// discover runs an endpoint discovery loop.
func (s *Session) discover() {
	s.log("opening")
	defer s.log("closed")
	defer s.connState("disconnected")

	var backoff Backoff

	for !s.stopped {
		s.log("endpoint discovery")
		s.connState("connecting")

		url := "https://" + s.address + endpointPath

		if channel, err := XHR(url, "", JitterDuration(discoveryTimeout, 0.1)); err != nil {
			s.log("endpoint discovery:", err)
		} else {
			select {
			case response, ok := <-channel:
				if !ok {
					s.log("endpoint discovery timeout")
				} else if response == "" {
					s.log("endpoint discovery error")
				} else if hosts, err := GetEndpointHosts(response); err != nil {
					s.log("endpoint discovery:", err)
				} else {
					s.log("endpoint discovered")

					if WebSocketSupported && !s.forceLongPoll {
						if s.connect(WebSocketTransport, hosts, &backoff) {
							continue
						}
					}

					s.connect(LongPollTransport, hosts, &backoff)
				}

			case <-s.closeNotify:
				return
			}
		}

		if delay := backoff.Failure(maxBackoffDelay); delay > 0 {
			s.log("sleeping")
			s.connState("disconnected")

			Sleep(delay)
		}
	}
}

// connect tries to connect to each host a few times using the given transport
// implementation.
func (s *Session) connect(transport Transport, hosts []string, backoff *Backoff) (transportWorked bool) {
	for trial := 0; trial < connectIterations; trial++ {
		for _, host := range hosts {
			s.connState("connecting")

			for i, c := range s.address {
				if c == '/' {
					host += s.address[i:]
					break
				}
			}

			//gopherjs:blocking
			connWorked, gotOnline := transport(s, host)

			if connWorked {
				transportWorked = true
			}

			if gotOnline {
				backoff.Success()
				return
			}

			if s.stopped {
				return
			}

			if delay := backoff.Failure(maxBackoffDelay); delay > 0 {
				s.log("sleeping")
				s.connState("disconnected")

				Sleep(delay)
			}
		}
	}

	return
}

// canLogin checks whether the makeCreateSessionAction method would make an
// action that has any chance of creating a session for an existing user.
// The answer is no if the action could succeed, but would create a new
// user.
func (s *Session) canLogin() bool {
	if s.sessionParams["access_key"] != nil {
		return true
	}

	if s.sessionParams["user_id"] != nil {
		return s.sessionParams["user_auth"] != nil || s.sessionParams["master_sign"] != nil
	}

	return s.sessionParams["identity_type"] != nil && s.sessionParams["identity_name"] != nil && s.sessionParams["identity_auth"] != nil
}

// makeCreateSessionAction makes a create_session action header.
func (s *Session) makeCreateSessionAction() (header *js.Object) {
	header = NewObject()
	header.Set("action", "create_session")

	if userId := s.sessionParams["user_id"]; userId == nil {
		// Client code is responsible for specifying correct parameters.

		for key, value := range s.sessionParams {
			header.Set(key, value)
		}
	} else {
		// This might be automatic session recreation, try to be smart.

		if userAuth := s.sessionParams["user_auth"]; userAuth != nil {
			header.Set("user_id", userId)
			header.Set("user_auth", userAuth)
		} else if masterSign := s.sessionParams["master_sign"]; masterSign != nil {
			header.Set("user_id", userId)
			header.Set("master_sign", masterSign)
		} else if identityType := s.sessionParams["identity_type"]; identityType != nil {
			header.Set("identity_type", identityType)
			header.Set("identity_name", s.sessionParams["identity_name"])
			header.Set("identity_auth", s.sessionParams["identity_auth"])
		} else {
			// Fallback: let the server decide.  (But still make sure that we
			// won't be creating a new user by accident.)

			header.Set("user_id", userId)
		}

		for key, value := range s.sessionParams {
			switch key {
			case "user_id", "user_auth", "identity_type", "identity_name", "identity_auth", "access_key", "master_sign":
				// skipped

			default:
				header.Set(key, value)
			}
		}
	}

	return
}

// makeResumeSessionAction makes a resume_session action header for
// initializing new connections, or polling and acknowledging events.
func (s *Session) makeResumeSessionAction(session bool) (header *js.Object) {
	header = NewObject()
	header.Set("action", "resume_session")
	header.Set("event_id", s.receivedEventId)

	if session {
		header.Set("session_id", s.sessionId)
	}

	s.sendEventAck = false
	s.ackedEventId = s.receivedEventId

	return
}

// handleSessionEvent establishes a session or fails.
func (s *Session) handleSessionEvent(header *js.Object) (ok bool) {
	userId, userAuth, sessionId, eventId, ok, err := GetSessionEventCredentials(header)

	if err != nil {
		s.log("session creation:", err)
	}

	if !jsInvoke(sessionSessionEventInvocationName, s.onSessionEvent, header) {
		ok = false
	}

	if !ok {
		s.sessionId = nil
		s.stopped = true
		return
	}

	delete(s.sessionParams, "user_attrs")
	delete(s.sessionParams, "user_settings")
	delete(s.sessionParams, "identity_attrs")
	delete(s.sessionParams, "access_key")
	delete(s.sessionParams, "master_sign")

	s.sessionParams["user_id"] = userId

	if userAuth != nil {
		s.sessionParams["user_auth"] = userAuth
	}

	for _, param := range []string{"identity_type", "identity_name", "identity_auth"} {
		if newValue := s.sessionParams[param+"_new"]; newValue != nil {
			delete(s.sessionParams, param+"_new")
			s.sessionParams[param] = newValue
		}
	}

	s.sessionId = sessionId

	if len(s.sendBuffer) == 0 {
		s.lastActionId = 0
	}

	s.sendEventAck = false
	s.receivedEventId = eventId
	s.ackedEventId = 0

	s.log("session created")

	ok = true
	return
}

// handleEvent parses the event header partially, does whatever is necessary,
// and usually passes the event to client code.
func (s *Session) handleEvent(header, payload *js.Object) (actionId uint64, sessionLost, needsAck, ok bool) {
	eventId, actionId, err := GetEventAndActionId(header)
	if err != nil {
		s.log("event:", err)
		return
	}

	if eventId > 0 {
		s.receivedEventId = eventId

		if !s.sendEventAck {
			if s.receivedEventId-s.ackedEventId >= sessionEventAckWindow {
				s.sendAck()
			} else {
				needsAck = true
			}
		}
	}

	if actionId > 0 {
		i := sort.Search(s.numSent, func(i int) bool {
			action := s.sendBuffer[i]
			return action.Id >= actionId
		})

		if i < s.numSent {
			if action := s.sendBuffer[i]; action.Id == actionId {
				lastReply, err := IsEventLastReply(header, action)
				if err != nil {
					s.log("event:", err)
					return
				}

				if action.Deferred != nil {
					if lastReply {
						action.Deferred.Resolve(header, payload)
					} else {
						action.Deferred.Notify(header, payload)
					}
				}

				if lastReply {
					s.sendBuffer = append(s.sendBuffer[:i], s.sendBuffer[i+1:]...)
					s.numSent--
				}
			}
		}
	}

	errorType, errorReason, sessionLost, err := GetEventError(header)
	if err != nil {
		s.log("event:", err)

		if sessionLost {
			s.sessionId = nil

			if !s.canLogin() {
				jsInvoke(sessionSessionEventInvocationName, s.onSessionEvent, header)
				s.stopped = true
			}
		}

		return
	}

	if errorType == "deprecated" {
		s.log("deprecated:", errorReason)
	}

	if !jsInvoke(sessionEventInvocationName, s.onEvent, header, payload) {
		return
	}

	ok = true
	return
}

// connState passes an enumeration value to the client code.
func (s *Session) connState(state string) {
	if s.latestConnState != state {
		s.latestConnState = state

		if s.onConnState != nil {
			jsInvoke(sessionConnStateInvocationName, s.onConnState, s.latestConnState)
		}
	}
}

// connActive passes the current time to the client code.
func (s *Session) connActive() {
	s.latestConnActive = Now()

	if s.onConnActive != nil {
		jsInvoke(sessionConnActiveInvocationName, s.onConnActive, s.latestConnActive)
	}
}

// log passes a message to the client code.
func (s *Session) log(tokens ...interface{}) {
	Log(sessionLogInvocationName, s.onLog, tokens...)
}
