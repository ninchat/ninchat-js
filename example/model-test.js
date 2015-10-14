function changeString(change) {
	switch (change) {
	case NinchatModel.ADDED:
		return "ADDED";

	case NinchatModel.UPDATED:
		return "UPDATED";

	case NinchatModel.REMOVED:
		return "REMOVED";
	}
}

function testModel() {
	var epoch = Date.now();
	var done = false;

	var state = NinchatModel.newState();
	console.log("state =", state);

	state.onSessionEvent(function(clientEvent) {
		console.log("RAW", clientEvent);
	});

	state.onEvent(function(clientEvent, payload) {
		console.log("RAW", clientEvent, payload);
	});

	state.onLog(function() {
		console.log("LOG", (Date.now() - epoch) / 1000.0, arguments);
	});

	state.Self.onChange(function(change, user, auth) {
		console.log("SELF", changeString(change), user, auth);
		console.log("SELF-ATTRS", user.getAttrs());
		console.log("state.Users.get(user.Id) =", state.Users.get(user.Id));

		var aux = user.getAux();
		if (!aux) {
			console.log("no aux self data");
			user.setAux({value: 100});
		} else {
			console.log("self aux value =", aux.value);
			aux.value++;
		}
	});

	state.Settings.onChange(function(change, settings) {
		console.log("SETTINGS", changeString(change), settings);
		console.log("state.Settings.get() =", state.Settings.get());
	});

	state.Users.onChange(function(change, user) {
		console.log("USER", changeString(change), user);
		console.log("USER-ATTRS", user.getAttrs());
		console.log("state.Users.get(user.Id) =", state.Users.get(user.Id));

		var aux = user.getAux();
		if (!aux) {
			console.log("no aux user data");
			user.setAux({value: 200});
		} else {
			console.log("user aux value =", aux.value);
			aux.value++;
		}
	});

	state.Dialogues.onChange(function(change, dialogue) {
		console.log("DIALOGUE", changeString(change), dialogue);
		console.log("DIALOGUE-SELF-MEMBER-ATTRS", dialogue.getSelfMemberAttrs());
		console.log("DIALOGUE-PEER-MEMBER-ATTRS", dialogue.getPeerMemberAttrs());
		console.log("state.Dialogues.get(dialogue.PeerId) =", state.Dialogues.get(dialogue.PeerId));

		var aux = dialogue.getAux();
		if (!aux) {
			console.log("no aux dialogue data");
			dialogue.setAux({value: 300});
		} else {
			console.log("dialogue aux value =", aux.value);
			aux.value++;
		}

		switch (change) {
		case NinchatModel.ADDED:
			function loadFailed(peerId, error) {
				alert(error);
			}

			function loadCallback(peerId) {
				console.log("DIALOGUE-HISTORY-LOADED", peerId);

				var dialogue = state.Dialogues.get(peerId);
				var window = dialogue.Window;
				console.log("DIALOGUE-HISTORY-EARLIEST", window.hasEarliest());

				if (!window.hasEarliest()) {
					state.Dialogues.loadEarlier(peerId).then(loadCallback, loadFailed);
				}
			};

			state.Dialogues.loadEarlier(dialogue.PeerId).then(loadCallback, loadFailed);
			break;

		case NinchatModel.REMOVED:
			setTimeout(state.close, 0);
			break;
		}
	});

	state.Dialogues.Messages.onReceive(function(peerId, event) {
		console.log("DIALOGUE-MESSAGE", event);

		var dialogue = state.Dialogues.get(peerId);
		var window = dialogue.Window;
		console.log("DIALOGUE-MESSAGE-WINDOW", window);
		if (window) {
			console.log("DIALOGUE-MESSAGE-WINDOW-LENGTH", window.getLength());
			console.log("DIALOGUE-MESSAGE-WINDOW-EARLIEST", window.hasEarliest());
		}

		var aux = dialogue.getAux();
		if (!aux) {
			console.log("no aux dialogue data");
			dialogue.setAux({value: 300});
		} else {
			console.log("dialogue aux value =", aux.value);
			aux.value++;
		}

		if (done) {
			state.Dialogues.discard(peerId);
			return;
		}

		if (peerId) {
			state.Dialogues.updateStatus(peerId, "hidden");

			setTimeout(function() {
				state.send({
					action:       "send_message",
					user_id:      peerId,
					message_type: "ninchat.com/text"
				}, [
					JSON.stringify({
						text: "hello again"
					})
				]);

				done = true;
			}, 1000);
		}
	});

	state.setParams({
		"user_settings": {
			foo: "bar",
			baz: ["quux"]
		},
		"message_types": ["*"]
	});

	state.open().then(function() {
		var user = state.Self.getUser();
		console.log("state.Self.getUser() =", user);
		console.log("state.Users.get(self.Id) =", state.Users.get(user.Id));

		var aux = user.getAux();
		if (!aux) {
			console.log("no aux self data");
			user.setAux({value: 100});
		} else {
			console.log("self aux value =", aux.value);
			aux.value++;
		}

		state.send({
			action:       "send_message",
			user_id:      user.Id,
			message_type: "ninchat.com/text"
		}, [
			JSON.stringify({
				text: "hello world"
			})
		]);
	}).catch(alert);
}
