/**
 * Ninchat API connection library.
 *
 * @see https://ninchat.com/api/v2
 *
 * @module NinchatClient
 */

/**
 * Call the sessionless API.  The returned promise will be resolved with an
 * event header array as a parameter to the callback functions, or rejected on
 * connection error.  Note that "error" events are delivered via the Promise's
 * resolve callback, not via the reject callback like when using a Session.
 * The notify callback is not used.
 *
 * @see https://ninchat.com/api/v2#sessionless-http-calling
 *
 * @param {object}   header     Action parameters to send.
 * @param {function} [onLog]    Message logger.
 * @param {string}   [address]  Alternative API endpoint.
 *
 * @return {NinchatClient~Promise}
 */
function call(header, onLog, address) {}

/**
 * Create an uninitialized Session object.
 *
 * @return {NinchatClient~Session}
 */
function newSession() {}

/**
 * Convert an event's payload part to a string.
 *
 * @param {object} data
 *
 * @return {string}
 */
function stringifyFrame(data) {}

/**
 * Session hides the details of API connection management.  It needs to be
 * initialized by calling at least the onSessionEvent, onEvent and
 * setParams methods.  After that the open method is used to make a
 * connection to the server.  Finally, the close method disconnects from
 * the server.
 *
 * Session objects may be instantiated only via the newSession function.
 *
 * @class
 */
function Session() {

	/**
	 * Set the session creation handler.  It will be invoked with a
	 * "session_created" or an "error" event header as a parameter.
	 *
	 * If another "session_created" event is received, it means that the
	 * previous session was lost, and a new one was established automatically.
	 *
	 * If an "error" event is received, it means that a new session can't be
	 * established without intervention.  The client code must call setParams()
	 * to supply new credentials, unless it decides to close().
	 *
	 * @param {function}  callback
	 */
	this.onSessionEvent = function(callback) {}

	/**
	 * Set the handler for in-session events. It will be invoked with an
	 * event header and a payload array parameter.
	 *
	 * "error" events received via this callback are not fatal.
	 *
	 * @param {function}  callback
	 */
	this.onEvent = function(callback) {}

	/**
	 * Set an optional connection state change monitor.  It will be called with
	 * one of the following strings:
	 *
	 * - "connecting"
	 * - "connected"
	 * - "disconnected"
	 *
	 * @param {function}  callback
	 */
	this.onConnState = function(callback) {}

	/**
	 * Set an optional connection activity monitor.  It will be called with a
	 * timestamp (in milliseconds) indicating the latest time when data was
	 * received on the connection.
	 *
	 * @param {function}  callback
	 */
	this.onConnActive = function(callback) {}

	/**
	 * Set an optional message logger.  It will be called with a single string
	 * argument.
	 *
	 * @param {function}  callback
	 */
	this.onLog = function(callback) {}

	/**
	 * Set "create_session" action parameters.  If open() has already been
	 * called, this takes effect when a session is lost.
	 *
	 * @param {object}  params
	 */
	this.setParams = function(params) {}

	/**
	 * Force a specific network transport implementation to be used.
	 * Currently only "longpoll" may be specified.
	 *
	 * @param {string}  name
	 */
	this.setTransport = function(name) {}

	/**
	 * Use an alternative API endpoint.
	 *
	 * @param {string}  address
	 */
	this.setAddress = function(address) {}

	/**
	 * Create a session on the server.
	 */
	this.open = function() {}

	/**
	 * Close the session on the server.
	 */
	this.close = function() {}

	/**
	 * Send an action.
	 *
	 * To send an action without an "action_id" parameter, specify it as
	 * null.  Otherwise an "action_id" is generated automatically.
	 *
	 * If an "action_id" is used, a promise is returned.  It may be used to
	 * wait for a reply from the server; the promise will be resolved with
	 * an event header and a payload array parameter.  If the Session
	 * object is closed before a reply is received, the promise will be
	 * rejected without a parameter.
	 *
	 * With specific actions that cause multiple reply events, the notify
	 * callback will be called for each event until the final event which
	 * resolves the promise.
	 *
	 * @param {object}  header     Action parameters to send.
	 * @param {array}   [payload]  Consists of (already encoded) data
	 *                             frames.
	 *
	 * @return {NinchatClient~Promise}
	 */
	this.send = function(header, payload) {}

}

/**
 * @class
 */
function Promise() {

	/**
	 * Add callback(s) to be called when the promise is resolved, updated
	 * (notify) or rejected.
	 *
	 * Promise objects may not be instantiated directly.
	 *
	 * @param {function}  [resolve]
	 * @param {function}  [reject]
	 * @param {function}  [notify]
	 */
	this.then = function(resolve, reject, notify) {};

}
