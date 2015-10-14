"use strict";

(function() {
	window.state = {
		Model:         NinchatModel.newState(),
		UserAttrs:     {},
		DialogueStuff: {},
	};

	state.Model.onConnState((connState) => {
		render(React.DOM.div(null, connState), "conn-state");
	});

	state.Model.onConnActive((time) => {
		render(React.DOM.div(null, new Date(time).toString()), "conn-active");
	});

	state.Model.onSessionEvent((header) => {
		console.log("SESSION-EVENT:", header.event)
	});

	state.Model.onEvent((header, payload) => {
		console.log("EVENT-" + header.event_id + ":", header.event)
	});

	state.Model.onLog((msg) => {
		console.log("LOG:", msg)
	});

	state.Model.Self.onChange((change, user, auth) => {
		if (auth) {
			let data = {
				id:   user.Id,
				auth: auth,
			};

			localStorage.setItem("ninchatModelApp", JSON.stringify(data));
		}

		render(createListElement({ [user.Id]: user.getAttrs() }), "self");
	});

	state.Model.Settings.onChange((change, settings) => {
		render(createListElement(settings), "settings");
	});

	state.Model.Users.onChange((change, user) => {
		state.UserAttrs[user.Id] = user.getAttrs();
		render(createListElement(state.UserAttrs), "users");
	});

	state.Model.Dialogues.onChange((change, dialogue) => {
		state.DialogueStuff[dialogue.PeerId] = {
			Status:           dialogue.getStatus(),
			SelfMemberAttrs:  dialogue.getSelfMemberAttrs(),
			PeerMemberAttrs:  dialogue.getPeerMemberAttrs(),
			AudienceMetadata: dialogue.getAudienceMetadata(),
		};
		render(createListElement(state.DialogueStuff), "dialogues");
		state.Model.Dialogues.activate(dialogue.peerId);
	});

	state.Model.Dialogues.Messages.onReceive((userId, event) => {});
	state.Model.Dialogues.Messages.onUpdate((userId, event) => {});

	let params = {
		message_types: ["*"],
	};

	let parts = window.location.hash.split("#");
	if (parts.length == 3) {
		window.location.hash = "";

		params.identity_type = "email";
		params.identity_name = parts[1];
		params.identity_auth = parts[2];
	} else {
		let json = localStorage.getItem("ninchatModelApp");
		if (json) {
			if (window.location.hash.length > 0)
				window.location.hash = "";

			let data = JSON.parse(json);
			params.user_id = data.id;
			params.user_auth = data.auth;
		}
	}

	state.Model.setParams(params);
	state.Model.open();

	window.addEventListener("unload", state.Model.close);
})();
