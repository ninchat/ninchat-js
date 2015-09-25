/**
 * Ninchat API connection library.
 *
 * @see https://ninchat.com/api/v2
 */
NinchatClient = {

	/**
	 * Call the sessionless API.  The returned [Promise](#promise) will be
	 * resolved with an event header array as a parameter to the callback
	 * functions, or rejected on connection error.  Note that `error` events
	 * are delivered via the promise's resolve callback, not via the reject
	 * callback like when using a Session.  The notify callback is not used.
	 *
	 * @see https://ninchat.com/api/v2#sessionless-http-calling
	 *
	 * @param {Object}   header     Action parameters to send.
	 * @param {Function} [onLog]    Message logger.
	 * @param {String}   [address]  Alternative API endpoint.
	 *
	 * @return {Promise}
	 *
	 * @name NinchatClient.call
	 */
	call: function(header, onLog, address) {},

	/**
	 * Create an uninitialized [Session](#session) object.
	 *
	 * @return {Session}
	 *
	 * @name NinchatClient.newSession
	 */
	newSession: function() {},

	/**
	 * Convert an event's payload part to a string.
	 *
	 * @param {Object} data
	 *
	 * @return {String}
	 *
	 * @name NinchatClient.stringifyFrame
	 */
	stringifyFrame: function(data) {}

};

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
	 * `session_created` or an `error` event header as a parameter.
	 *
	 * If another `session_created` event is received, it means that the
	 * previous session was lost, and a new one was established automatically.
	 *
	 * If an `error` event is received, it means that a new session can't be
	 * established without intervention.  The client code must call setParams()
	 * to supply new credentials, unless it decides to close().
	 *
	 * @param {Function}  callback
	 *
	 * @name Session.onSessionEvent
	 */
	this.onSessionEvent = function(callback) {}

	/**
	 * Set the handler for in-session events. It will be invoked with an
	 * event header and a payload array parameter.
	 *
	 * `error` events received via this callback are not fatal.
	 *
	 * @param {Function}  callback
	 *
	 * @name Session.onEvent
	 */
	this.onEvent = function(callback) {}

	/**
	 * Set an optional connection state change monitor.  It will be called with
	 * one of the following strings:
	 *
	 * - `connecting`
	 * - `connected`
	 * - `disconnected`
	 *
	 * @param {Function}  callback
	 *
	 * @name Session.onConnState
	 */
	this.onConnState = function(callback) {}

	/**
	 * Set an optional connection activity monitor.  It will be called with a
	 * timestamp (in milliseconds) indicating the latest time when data was
	 * received on the connection.
	 *
	 * @param {Function}  callback
	 *
	 * @name Session.onConnActive
	 */
	this.onConnActive = function(callback) {}

	/**
	 * Set an optional message logger.  It will be called with a single string
	 * argument.
	 *
	 * @param {Function}  callback
	 *
	 * @name Session.onLog
	 */
	this.onLog = function(callback) {}

	/**
	 * Set `create_session` action parameters.  If open() has already been
	 * called, this takes effect when a session is lost.
	 *
	 * @param {Object}  params
	 *
	 * @name Session.setParams
	 */
	this.setParams = function(params) {}

	/**
	 * Force a specific network transport implementation to be used.
	 * Currently only `longpoll` may be specified.
	 *
	 * @param {String}  name
	 *
	 * @name Session.setTransport
	 */
	this.setTransport = function(name) {}

	/**
	 * Use an alternative API endpoint.
	 *
	 * @param {String}  address
	 *
	 * @name Session.setAddress
	 */
	this.setAddress = function(address) {}

	/**
	 * Create a session on the server.
	 *
	 * @name Session.open
	 */
	this.open = function() {}

	/**
	 * Close the session on the server.
	 *
	 * @name Session.close
	 */
	this.close = function() {}

	/**
	 * Send an action.
	 *
	 * To send an action without an `action_id` parameter, specify it as
	 * null.  Otherwise an `action_id` is generated automatically.
	 *
	 * If an `action_id` is used, a [Promise](#promise) is returned.  It may be
	 * used to wait for a reply from the server; the promise will be resolved
	 * with an event header and a payload array parameter.  If the Session
	 * object is closed before a reply is received, the promise will be
	 * rejected without a parameter.
	 *
	 * With specific actions that cause multiple reply events, the notify
	 * callback will be called for each event until the final event which
	 * resolves the promise.
	 *
	 * @param {Object}  header     Action parameters to send.
	 * @param {Array}   [payload]  Consists of (already encoded) data
	 *                             frames.
	 *
	 * @return {Promise}
	 *
	 * @name Session.send
	 */
	this.send = function(header, payload) {}

};

/**
 * Promise objects may not be instantiated directly.
 *
 * @class
 */
function Promise() {

	/**
	 * Add callback(s) to be called when the promise is resolved, updated
	 * (notify) or rejected.
	 *
	 * @param {Function}  [resolve]
	 * @param {Function}  [reject]
	 * @param {Function}  [notify]
	 *
	 * @name Promise.then
	 */
	this.then = function(resolve, reject, notify) {};

};
