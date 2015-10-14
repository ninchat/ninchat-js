"use strict";

function render(element, id) {
	ReactDOM.render(element, document.getElementById(id));
}

function createListElement(object) {
	let keyAttrs = { className: "key" };
	let rows = [];

	for (let key in object) {
		let value = object[key];
		var valueClass;
		var valueTag = null;

		switch (typeof value) {
		case "string":
			valueClass = "value scalar";
			if (value !== null)
				valueTag = React.DOM.div(null, value);
			break;

		case "object":
			valueClass = "value";
			if (value !== null)
				valueTag = createListElement(value);
			break;

		default:
			valueClass = "value scalar";
			if (value !== null && value !== false)
				valueTag = React.DOM.div(null, JSON.stringify(value));
			break;
		}

		rows.push(React.DOM.tr(
			null,
			React.DOM.td({ className: "key" }, key + ":"),
			React.DOM.td({ className: valueClass }, valueTag)
		));
	}

	return React.DOM.table(null, React.DOM.tbody(null, ...rows));
}
