function myTypeOf(x) {
	return typeof x;
}

function print(text) {
	var date = (new Date()).toString();

	var row = document.createElement("tr");
	row.innerHTML = "<td>" + date + "</td><td>" + text + "</td>";

	var output = document.getElementById("output")
	output.appendChild(row);

	row.scrollIntoView();
}

function testClient() {
	var session = NinchatClient.newSession();
	var userAuth;

	session.onSessionEvent(function(sessionHeader) {
		print("SESSION: " + JSON.stringify(sessionHeader));

		if (sessionHeader.event == "session_created") {
			userAuth = sessionHeader.user_auth;

			var sendSequence = 1;

			var intervalId = setInterval(function() {
				var messageHeader = {
					action:       "send_message",
					user_id:      sessionHeader.user_id,
					message_type: "ninchat.com/text"
				};

				var messagePayload = [
					JSON.stringify({"text": "" + sendSequence})
				];

				session.send(messageHeader, messagePayload);

				if (sendSequence == 100) {
					clearInterval(intervalId);
				} else {
					sendSequence++;
				}
			}, 100);
		} else {
			session.close();
		}
	});

	var eventSequence = 2;
	var actionSequence = 1;
	var receiveSequence = [];
	var closing = false;

	session.onEvent(function(header, payload) {
		print("HEADER: " + JSON.stringify(header));

		if (header.event_id !== undefined) {
			if (header.event_id == (eventSequence++)) {
				print("EVENT: " + header.event_id);
			} else {
				print("EVENT OUT OF SEQUENCE: " + header.event_id);
			}
		}

		if (header.action_id !== undefined) {
			if (header.action_id == (actionSequence++)) {
				print("ACTION: " + header.action_id);
			} else {
				print("ACTION: " + header.action_id + " (out of sequence)");
			}
		}

		if (payload) {
			var msg = NinchatClient.stringifyFrame(payload[0]);
			var seq = parseInt(JSON.parse(msg).text);
			print("MESSAGE: " + msg);
			receiveSequence.push(seq);

			if (seq >= 100 && !closing) {
				closing = true;

				setTimeout(function() {
					session.send({
						action:    "delete_user",
						user_auth: userAuth
					});

					var ok = true;

					for (var find = 1; find <= 100; find++) {
						var found = false;

						for (var i = 0; i < receiveSequence.length; i++) {
							if (receiveSequence[i] === find) {
								found = true;
								break;
							}
						}

						if (!found) {
							print("MISSING MESSAGE: " + find);
							ok = false;
						}
					}

					if (ok) {
						print("ALL MESSAGES RECEIVED");
					}
				}, 3000);
			}
		}
	});

	session.onConnState(function(state) {
		print("STATE: " + state);
	});

	if (false) {
		session.onConnActive(function(time) {
			print("ACTIVE: " + (new Date(time)).toString());
		});
	}

	session.onLog(function(message) {
		print("LOG: " + message);
	});

	if (false) {
		// don't even try websocket
		session.setTransport("longpoll");
	}

	var params = {
		message_types: [
			"ninchat.com/info/*",
			"ninchat.com/link",
			"ninchat.com/notice",
			"ninchat.com/text"
		]
	};

	if (false) {
		// log in with an identity
		params.identity_type = "email";
		params.identity_name = "bob@example.invalid";
		params.identity_auth = "password goes here";
	} else if (false) {
		// log in with a user agent authentication token
		params.user_id = "user id goes here";
		params.user_auth = "secret token goes here";
	} else if (false) {
		// create a new user and associate a new identity to it
		params.identity_type_new = "email";
		params.identity_name_new = "bob@example.invalid";
		params.identity_auth_new = "password goes here";
	} else {
		// create a new user without an identity
	}

	session.setParams(params);
	session.open();
}
