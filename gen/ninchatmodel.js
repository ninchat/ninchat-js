"use strict";
(function() {

Error.stackTraceLimit = Infinity;

var $global, $module;
if (typeof window !== "undefined") { /* web page */
  $global = window;
} else if (typeof self !== "undefined") { /* web worker */
  $global = self;
} else if (typeof global !== "undefined") { /* Node.js */
  $global = global;
  $global.require = require;
} else { /* others (e.g. Nashorn) */
  $global = this;
}

if ($global === undefined || $global.Array === undefined) {
  throw new Error("no global object found");
}
if (typeof module !== "undefined") {
  $module = module;
}

var $packages = {}, $idCounter = 0;
var $keys = function(m) { return m ? Object.keys(m) : []; };
var $flushConsole = function() {};
var $throwRuntimeError; /* set by package "runtime" */
var $throwNilPointerError = function() { $throwRuntimeError("invalid memory address or nil pointer dereference"); };
var $call = function(fn, rcvr, args) { return fn.apply(rcvr, args); };
var $makeFunc = function(fn) { return function() { return fn(new ($sliceType($jsObjectPtr))($global.Array.prototype.slice.call(arguments, []))); } };

var $mapArray = function(array, f) {
  var newArray = new array.constructor(array.length);
  for (var i = 0; i < array.length; i++) {
    newArray[i] = f(array[i]);
  }
  return newArray;
};

var $methodVal = function(recv, name) {
  var vals = recv.$methodVals || {};
  recv.$methodVals = vals; /* noop for primitives */
  var f = vals[name];
  if (f !== undefined) {
    return f;
  }
  var method = recv[name];
  f = function() {
    $stackDepthOffset--;
    try {
      return method.apply(recv, arguments);
    } finally {
      $stackDepthOffset++;
    }
  };
  vals[name] = f;
  return f;
};

var $methodExpr = function(typ, name) {
  var method = typ.prototype[name];
  if (method.$expr === undefined) {
    method.$expr = function() {
      $stackDepthOffset--;
      try {
        if (typ.wrapped) {
          arguments[0] = new typ(arguments[0]);
        }
        return Function.call.apply(method, arguments);
      } finally {
        $stackDepthOffset++;
      }
    };
  }
  return method.$expr;
};

var $ifaceMethodExprs = {};
var $ifaceMethodExpr = function(name) {
  var expr = $ifaceMethodExprs["$" + name];
  if (expr === undefined) {
    expr = $ifaceMethodExprs["$" + name] = function() {
      $stackDepthOffset--;
      try {
        return Function.call.apply(arguments[0][name], arguments);
      } finally {
        $stackDepthOffset++;
      }
    };
  }
  return expr;
};

var $subslice = function(slice, low, high, max) {
  if (low < 0 || high < low || max < high || high > slice.$capacity || max > slice.$capacity) {
    $throwRuntimeError("slice bounds out of range");
  }
  var s = new slice.constructor(slice.$array);
  s.$offset = slice.$offset + low;
  s.$length = slice.$length - low;
  s.$capacity = slice.$capacity - low;
  if (high !== undefined) {
    s.$length = high - low;
  }
  if (max !== undefined) {
    s.$capacity = max - low;
  }
  return s;
};

var $sliceToArray = function(slice) {
  if (slice.$length === 0) {
    return [];
  }
  if (slice.$array.constructor !== Array) {
    return slice.$array.subarray(slice.$offset, slice.$offset + slice.$length);
  }
  return slice.$array.slice(slice.$offset, slice.$offset + slice.$length);
};

var $decodeRune = function(str, pos) {
  var c0 = str.charCodeAt(pos);

  if (c0 < 0x80) {
    return [c0, 1];
  }

  if (c0 !== c0 || c0 < 0xC0) {
    return [0xFFFD, 1];
  }

  var c1 = str.charCodeAt(pos + 1);
  if (c1 !== c1 || c1 < 0x80 || 0xC0 <= c1) {
    return [0xFFFD, 1];
  }

  if (c0 < 0xE0) {
    var r = (c0 & 0x1F) << 6 | (c1 & 0x3F);
    if (r <= 0x7F) {
      return [0xFFFD, 1];
    }
    return [r, 2];
  }

  var c2 = str.charCodeAt(pos + 2);
  if (c2 !== c2 || c2 < 0x80 || 0xC0 <= c2) {
    return [0xFFFD, 1];
  }

  if (c0 < 0xF0) {
    var r = (c0 & 0x0F) << 12 | (c1 & 0x3F) << 6 | (c2 & 0x3F);
    if (r <= 0x7FF) {
      return [0xFFFD, 1];
    }
    if (0xD800 <= r && r <= 0xDFFF) {
      return [0xFFFD, 1];
    }
    return [r, 3];
  }

  var c3 = str.charCodeAt(pos + 3);
  if (c3 !== c3 || c3 < 0x80 || 0xC0 <= c3) {
    return [0xFFFD, 1];
  }

  if (c0 < 0xF8) {
    var r = (c0 & 0x07) << 18 | (c1 & 0x3F) << 12 | (c2 & 0x3F) << 6 | (c3 & 0x3F);
    if (r <= 0xFFFF || 0x10FFFF < r) {
      return [0xFFFD, 1];
    }
    return [r, 4];
  }

  return [0xFFFD, 1];
};

var $encodeRune = function(r) {
  if (r < 0 || r > 0x10FFFF || (0xD800 <= r && r <= 0xDFFF)) {
    r = 0xFFFD;
  }
  if (r <= 0x7F) {
    return String.fromCharCode(r);
  }
  if (r <= 0x7FF) {
    return String.fromCharCode(0xC0 | r >> 6, 0x80 | (r & 0x3F));
  }
  if (r <= 0xFFFF) {
    return String.fromCharCode(0xE0 | r >> 12, 0x80 | (r >> 6 & 0x3F), 0x80 | (r & 0x3F));
  }
  return String.fromCharCode(0xF0 | r >> 18, 0x80 | (r >> 12 & 0x3F), 0x80 | (r >> 6 & 0x3F), 0x80 | (r & 0x3F));
};

var $stringToBytes = function(str) {
  var array = new Uint8Array(str.length);
  for (var i = 0; i < str.length; i++) {
    array[i] = str.charCodeAt(i);
  }
  return array;
};

var $bytesToString = function(slice) {
  if (slice.$length === 0) {
    return "";
  }
  var str = "";
  for (var i = 0; i < slice.$length; i += 10000) {
    str += String.fromCharCode.apply(undefined, slice.$array.subarray(slice.$offset + i, slice.$offset + Math.min(slice.$length, i + 10000)));
  }
  return str;
};

var $stringToRunes = function(str) {
  var array = new Int32Array(str.length);
  var rune, j = 0;
  for (var i = 0; i < str.length; i += rune[1], j++) {
    rune = $decodeRune(str, i);
    array[j] = rune[0];
  }
  return array.subarray(0, j);
};

var $runesToString = function(slice) {
  if (slice.$length === 0) {
    return "";
  }
  var str = "";
  for (var i = 0; i < slice.$length; i++) {
    str += $encodeRune(slice.$array[slice.$offset + i]);
  }
  return str;
};

var $copyString = function(dst, src) {
  var n = Math.min(src.length, dst.$length);
  for (var i = 0; i < n; i++) {
    dst.$array[dst.$offset + i] = src.charCodeAt(i);
  }
  return n;
};

var $copySlice = function(dst, src) {
  var n = Math.min(src.$length, dst.$length);
  $copyArray(dst.$array, src.$array, dst.$offset, src.$offset, n, dst.constructor.elem);
  return n;
};

var $copyArray = function(dst, src, dstOffset, srcOffset, n, elem) {
  if (n === 0 || (dst === src && dstOffset === srcOffset)) {
    return;
  }

  if (src.subarray) {
    dst.set(src.subarray(srcOffset, srcOffset + n), dstOffset);
    return;
  }

  switch (elem.kind) {
  case $kindArray:
  case $kindStruct:
    if (dst === src && dstOffset > srcOffset) {
      for (var i = n - 1; i >= 0; i--) {
        elem.copy(dst[dstOffset + i], src[srcOffset + i]);
      }
      return;
    }
    for (var i = 0; i < n; i++) {
      elem.copy(dst[dstOffset + i], src[srcOffset + i]);
    }
    return;
  }

  if (dst === src && dstOffset > srcOffset) {
    for (var i = n - 1; i >= 0; i--) {
      dst[dstOffset + i] = src[srcOffset + i];
    }
    return;
  }
  for (var i = 0; i < n; i++) {
    dst[dstOffset + i] = src[srcOffset + i];
  }
};

var $clone = function(src, type) {
  var clone = type.zero();
  type.copy(clone, src);
  return clone;
};

var $pointerOfStructConversion = function(obj, type) {
  if(obj.$proxies === undefined) {
    obj.$proxies = {};
    obj.$proxies[obj.constructor.string] = obj;
  }
  var proxy = obj.$proxies[type.string];
  if (proxy === undefined) {
    var properties = {};
    for (var i = 0; i < type.elem.fields.length; i++) {
      (function(fieldProp) {
        properties[fieldProp] = {
          get: function() { return obj[fieldProp]; },
          set: function(value) { obj[fieldProp] = value; }
        };
      })(type.elem.fields[i].prop);
    }
    proxy = Object.create(type.prototype, properties);
    proxy.$val = proxy;
    obj.$proxies[type.string] = proxy;
    proxy.$proxies = obj.$proxies;
  }
  return proxy;
};

var $append = function(slice) {
  return $internalAppend(slice, arguments, 1, arguments.length - 1);
};

var $appendSlice = function(slice, toAppend) {
  if (toAppend.constructor === String) {
    var bytes = $stringToBytes(toAppend);
    return $internalAppend(slice, bytes, 0, bytes.length);
  }
  return $internalAppend(slice, toAppend.$array, toAppend.$offset, toAppend.$length);
};

var $internalAppend = function(slice, array, offset, length) {
  if (length === 0) {
    return slice;
  }

  var newArray = slice.$array;
  var newOffset = slice.$offset;
  var newLength = slice.$length + length;
  var newCapacity = slice.$capacity;

  if (newLength > newCapacity) {
    newOffset = 0;
    newCapacity = Math.max(newLength, slice.$capacity < 1024 ? slice.$capacity * 2 : Math.floor(slice.$capacity * 5 / 4));

    if (slice.$array.constructor === Array) {
      newArray = slice.$array.slice(slice.$offset, slice.$offset + slice.$length);
      newArray.length = newCapacity;
      var zero = slice.constructor.elem.zero;
      for (var i = slice.$length; i < newCapacity; i++) {
        newArray[i] = zero();
      }
    } else {
      newArray = new slice.$array.constructor(newCapacity);
      newArray.set(slice.$array.subarray(slice.$offset, slice.$offset + slice.$length));
    }
  }

  $copyArray(newArray, array, newOffset + slice.$length, offset, length, slice.constructor.elem);

  var newSlice = new slice.constructor(newArray);
  newSlice.$offset = newOffset;
  newSlice.$length = newLength;
  newSlice.$capacity = newCapacity;
  return newSlice;
};

var $equal = function(a, b, type) {
  if (type === $jsObjectPtr) {
    return a === b;
  }
  switch (type.kind) {
  case $kindComplex64:
  case $kindComplex128:
    return a.$real === b.$real && a.$imag === b.$imag;
  case $kindInt64:
  case $kindUint64:
    return a.$high === b.$high && a.$low === b.$low;
  case $kindArray:
    if (a.length !== b.length) {
      return false;
    }
    for (var i = 0; i < a.length; i++) {
      if (!$equal(a[i], b[i], type.elem)) {
        return false;
      }
    }
    return true;
  case $kindStruct:
    for (var i = 0; i < type.fields.length; i++) {
      var f = type.fields[i];
      if (!$equal(a[f.prop], b[f.prop], f.typ)) {
        return false;
      }
    }
    return true;
  case $kindInterface:
    return $interfaceIsEqual(a, b);
  default:
    return a === b;
  }
};

var $interfaceIsEqual = function(a, b) {
  if (a === $ifaceNil || b === $ifaceNil) {
    return a === b;
  }
  if (a.constructor !== b.constructor) {
    return false;
  }
  if (a.constructor === $jsObjectPtr) {
    return a.object === b.object;
  }
  if (!a.constructor.comparable) {
    $throwRuntimeError("comparing uncomparable type " + a.constructor.string);
  }
  return $equal(a.$val, b.$val, a.constructor);
};

var $min = Math.min;
var $mod = function(x, y) { return x % y; };
var $parseInt = parseInt;
var $parseFloat = function(f) {
  if (f !== undefined && f !== null && f.constructor === Number) {
    return f;
  }
  return parseFloat(f);
};

var $froundBuf = new Float32Array(1);
var $fround = Math.fround || function(f) {
  $froundBuf[0] = f;
  return $froundBuf[0];
};

var $imul = Math.imul || function(a, b) {
  var ah = (a >>> 16) & 0xffff;
  var al = a & 0xffff;
  var bh = (b >>> 16) & 0xffff;
  var bl = b & 0xffff;
  return ((al * bl) + (((ah * bl + al * bh) << 16) >>> 0) >> 0);
};

var $floatKey = function(f) {
  if (f !== f) {
    $idCounter++;
    return "NaN$" + $idCounter;
  }
  return String(f);
};

var $flatten64 = function(x) {
  return x.$high * 4294967296 + x.$low;
};

var $shiftLeft64 = function(x, y) {
  if (y === 0) {
    return x;
  }
  if (y < 32) {
    return new x.constructor(x.$high << y | x.$low >>> (32 - y), (x.$low << y) >>> 0);
  }
  if (y < 64) {
    return new x.constructor(x.$low << (y - 32), 0);
  }
  return new x.constructor(0, 0);
};

var $shiftRightInt64 = function(x, y) {
  if (y === 0) {
    return x;
  }
  if (y < 32) {
    return new x.constructor(x.$high >> y, (x.$low >>> y | x.$high << (32 - y)) >>> 0);
  }
  if (y < 64) {
    return new x.constructor(x.$high >> 31, (x.$high >> (y - 32)) >>> 0);
  }
  if (x.$high < 0) {
    return new x.constructor(-1, 4294967295);
  }
  return new x.constructor(0, 0);
};

var $shiftRightUint64 = function(x, y) {
  if (y === 0) {
    return x;
  }
  if (y < 32) {
    return new x.constructor(x.$high >>> y, (x.$low >>> y | x.$high << (32 - y)) >>> 0);
  }
  if (y < 64) {
    return new x.constructor(0, x.$high >>> (y - 32));
  }
  return new x.constructor(0, 0);
};

var $mul64 = function(x, y) {
  var high = 0, low = 0;
  if ((y.$low & 1) !== 0) {
    high = x.$high;
    low = x.$low;
  }
  for (var i = 1; i < 32; i++) {
    if ((y.$low & 1<<i) !== 0) {
      high += x.$high << i | x.$low >>> (32 - i);
      low += (x.$low << i) >>> 0;
    }
  }
  for (var i = 0; i < 32; i++) {
    if ((y.$high & 1<<i) !== 0) {
      high += x.$low << i;
    }
  }
  return new x.constructor(high, low);
};

var $div64 = function(x, y, returnRemainder) {
  if (y.$high === 0 && y.$low === 0) {
    $throwRuntimeError("integer divide by zero");
  }

  var s = 1;
  var rs = 1;

  var xHigh = x.$high;
  var xLow = x.$low;
  if (xHigh < 0) {
    s = -1;
    rs = -1;
    xHigh = -xHigh;
    if (xLow !== 0) {
      xHigh--;
      xLow = 4294967296 - xLow;
    }
  }

  var yHigh = y.$high;
  var yLow = y.$low;
  if (y.$high < 0) {
    s *= -1;
    yHigh = -yHigh;
    if (yLow !== 0) {
      yHigh--;
      yLow = 4294967296 - yLow;
    }
  }

  var high = 0, low = 0, n = 0;
  while (yHigh < 2147483648 && ((xHigh > yHigh) || (xHigh === yHigh && xLow > yLow))) {
    yHigh = (yHigh << 1 | yLow >>> 31) >>> 0;
    yLow = (yLow << 1) >>> 0;
    n++;
  }
  for (var i = 0; i <= n; i++) {
    high = high << 1 | low >>> 31;
    low = (low << 1) >>> 0;
    if ((xHigh > yHigh) || (xHigh === yHigh && xLow >= yLow)) {
      xHigh = xHigh - yHigh;
      xLow = xLow - yLow;
      if (xLow < 0) {
        xHigh--;
        xLow += 4294967296;
      }
      low++;
      if (low === 4294967296) {
        high++;
        low = 0;
      }
    }
    yLow = (yLow >>> 1 | yHigh << (32 - 1)) >>> 0;
    yHigh = yHigh >>> 1;
  }

  if (returnRemainder) {
    return new x.constructor(xHigh * rs, xLow * rs);
  }
  return new x.constructor(high * s, low * s);
};

var $divComplex = function(n, d) {
  var ninf = n.$real === Infinity || n.$real === -Infinity || n.$imag === Infinity || n.$imag === -Infinity;
  var dinf = d.$real === Infinity || d.$real === -Infinity || d.$imag === Infinity || d.$imag === -Infinity;
  var nnan = !ninf && (n.$real !== n.$real || n.$imag !== n.$imag);
  var dnan = !dinf && (d.$real !== d.$real || d.$imag !== d.$imag);
  if(nnan || dnan) {
    return new n.constructor(NaN, NaN);
  }
  if (ninf && !dinf) {
    return new n.constructor(Infinity, Infinity);
  }
  if (!ninf && dinf) {
    return new n.constructor(0, 0);
  }
  if (d.$real === 0 && d.$imag === 0) {
    if (n.$real === 0 && n.$imag === 0) {
      return new n.constructor(NaN, NaN);
    }
    return new n.constructor(Infinity, Infinity);
  }
  var a = Math.abs(d.$real);
  var b = Math.abs(d.$imag);
  if (a <= b) {
    var ratio = d.$real / d.$imag;
    var denom = d.$real * ratio + d.$imag;
    return new n.constructor((n.$real * ratio + n.$imag) / denom, (n.$imag * ratio - n.$real) / denom);
  }
  var ratio = d.$imag / d.$real;
  var denom = d.$imag * ratio + d.$real;
  return new n.constructor((n.$imag * ratio + n.$real) / denom, (n.$imag - n.$real * ratio) / denom);
};

var $kindBool = 1;
var $kindInt = 2;
var $kindInt8 = 3;
var $kindInt16 = 4;
var $kindInt32 = 5;
var $kindInt64 = 6;
var $kindUint = 7;
var $kindUint8 = 8;
var $kindUint16 = 9;
var $kindUint32 = 10;
var $kindUint64 = 11;
var $kindUintptr = 12;
var $kindFloat32 = 13;
var $kindFloat64 = 14;
var $kindComplex64 = 15;
var $kindComplex128 = 16;
var $kindArray = 17;
var $kindChan = 18;
var $kindFunc = 19;
var $kindInterface = 20;
var $kindMap = 21;
var $kindPtr = 22;
var $kindSlice = 23;
var $kindString = 24;
var $kindStruct = 25;
var $kindUnsafePointer = 26;

var $methodSynthesizers = [];
var $addMethodSynthesizer = function(f) {
  if ($methodSynthesizers === null) {
    f();
    return;
  }
  $methodSynthesizers.push(f);
};
var $synthesizeMethods = function() {
  $methodSynthesizers.forEach(function(f) { f(); });
  $methodSynthesizers = null;
};

var $ifaceKeyFor = function(x) {
  if (x === $ifaceNil) {
    return 'nil';
  }
  var c = x.constructor;
  return c.string + '$' + c.keyFor(x.$val);
};

var $identity = function(x) { return x; };

var $typeIDCounter = 0;

var $idKey = function(x) {
  if (x.$id === undefined) {
    $idCounter++;
    x.$id = $idCounter;
  }
  return String(x.$id);
};

var $newType = function(size, kind, string, name, pkg, constructor) {
  var typ;
  switch(kind) {
  case $kindBool:
  case $kindInt:
  case $kindInt8:
  case $kindInt16:
  case $kindInt32:
  case $kindUint:
  case $kindUint8:
  case $kindUint16:
  case $kindUint32:
  case $kindUintptr:
  case $kindUnsafePointer:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.keyFor = $identity;
    break;

  case $kindString:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.keyFor = function(x) { return "$" + x; };
    break;

  case $kindFloat32:
  case $kindFloat64:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.keyFor = function(x) { return $floatKey(x); };
    break;

  case $kindInt64:
    typ = function(high, low) {
      this.$high = (high + Math.floor(Math.ceil(low) / 4294967296)) >> 0;
      this.$low = low >>> 0;
      this.$val = this;
    };
    typ.keyFor = function(x) { return x.$high + "$" + x.$low; };
    break;

  case $kindUint64:
    typ = function(high, low) {
      this.$high = (high + Math.floor(Math.ceil(low) / 4294967296)) >>> 0;
      this.$low = low >>> 0;
      this.$val = this;
    };
    typ.keyFor = function(x) { return x.$high + "$" + x.$low; };
    break;

  case $kindComplex64:
    typ = function(real, imag) {
      this.$real = $fround(real);
      this.$imag = $fround(imag);
      this.$val = this;
    };
    typ.keyFor = function(x) { return x.$real + "$" + x.$imag; };
    break;

  case $kindComplex128:
    typ = function(real, imag) {
      this.$real = real;
      this.$imag = imag;
      this.$val = this;
    };
    typ.keyFor = function(x) { return x.$real + "$" + x.$imag; };
    break;

  case $kindArray:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.ptr = $newType(4, $kindPtr, "*" + string, "", "", function(array) {
      this.$get = function() { return array; };
      this.$set = function(v) { typ.copy(this, v); };
      this.$val = array;
    });
    typ.init = function(elem, len) {
      typ.elem = elem;
      typ.len = len;
      typ.comparable = elem.comparable;
      typ.keyFor = function(x) {
        return Array.prototype.join.call($mapArray(x, function(e) {
          return String(elem.keyFor(e)).replace(/\\/g, "\\\\").replace(/\$/g, "\\$");
        }), "$");
      };
      typ.copy = function(dst, src) {
        $copyArray(dst, src, 0, 0, src.length, elem);
      };
      typ.ptr.init(typ);
      Object.defineProperty(typ.ptr.nil, "nilCheck", { get: $throwNilPointerError });
    };
    break;

  case $kindChan:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.keyFor = $idKey;
    typ.init = function(elem, sendOnly, recvOnly) {
      typ.elem = elem;
      typ.sendOnly = sendOnly;
      typ.recvOnly = recvOnly;
    };
    break;

  case $kindFunc:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.init = function(params, results, variadic) {
      typ.params = params;
      typ.results = results;
      typ.variadic = variadic;
      typ.comparable = false;
    };
    break;

  case $kindInterface:
    typ = { implementedBy: {}, missingMethodFor: {} };
    typ.keyFor = $ifaceKeyFor;
    typ.init = function(methods) {
      typ.methods = methods;
      methods.forEach(function(m) {
        $ifaceNil[m.prop] = $throwNilPointerError;
      });
    };
    break;

  case $kindMap:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.init = function(key, elem) {
      typ.key = key;
      typ.elem = elem;
      typ.comparable = false;
    };
    break;

  case $kindPtr:
    typ = constructor || function(getter, setter, target) {
      this.$get = getter;
      this.$set = setter;
      this.$target = target;
      this.$val = this;
    };
    typ.keyFor = $idKey;
    typ.init = function(elem) {
      typ.elem = elem;
      typ.wrapped = (elem.kind === $kindArray);
      typ.nil = new typ($throwNilPointerError, $throwNilPointerError);
    };
    break;

  case $kindSlice:
    typ = function(array) {
      if (array.constructor !== typ.nativeArray) {
        array = new typ.nativeArray(array);
      }
      this.$array = array;
      this.$offset = 0;
      this.$length = array.length;
      this.$capacity = array.length;
      this.$val = this;
    };
    typ.init = function(elem) {
      typ.elem = elem;
      typ.comparable = false;
      typ.nativeArray = $nativeArray(elem.kind);
      typ.nil = new typ([]);
    };
    break;

  case $kindStruct:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.ptr = $newType(4, $kindPtr, "*" + string, "", "", constructor);
    typ.ptr.elem = typ;
    typ.ptr.prototype.$get = function() { return this; };
    typ.ptr.prototype.$set = function(v) { typ.copy(this, v); };
    typ.init = function(fields) {
      typ.fields = fields;
      fields.forEach(function(f) {
        if (!f.typ.comparable) {
          typ.comparable = false;
        }
      });
      typ.keyFor = function(x) {
        var val = x.$val;
        return $mapArray(fields, function(f) {
          return String(f.typ.keyFor(val[f.prop])).replace(/\\/g, "\\\\").replace(/\$/g, "\\$");
        }).join("$");
      };
      typ.copy = function(dst, src) {
        for (var i = 0; i < fields.length; i++) {
          var f = fields[i];
          switch (f.typ.kind) {
          case $kindArray:
          case $kindStruct:
            f.typ.copy(dst[f.prop], src[f.prop]);
            continue;
          default:
            dst[f.prop] = src[f.prop];
            continue;
          }
        }
      };
      /* nil value */
      var properties = {};
      fields.forEach(function(f) {
        properties[f.prop] = { get: $throwNilPointerError, set: $throwNilPointerError };
      });
      typ.ptr.nil = Object.create(constructor.prototype, properties);
      typ.ptr.nil.$val = typ.ptr.nil;
      /* methods for embedded fields */
      $addMethodSynthesizer(function() {
        var synthesizeMethod = function(target, m, f) {
          if (target.prototype[m.prop] !== undefined) { return; }
          target.prototype[m.prop] = function() {
            var v = this.$val[f.prop];
            if (f.typ === $jsObjectPtr) {
              v = new $jsObjectPtr(v);
            }
            if (v.$val === undefined) {
              v = new f.typ(v);
            }
            return v[m.prop].apply(v, arguments);
          };
        };
        fields.forEach(function(f) {
          if (f.name === "") {
            $methodSet(f.typ).forEach(function(m) {
              synthesizeMethod(typ, m, f);
              synthesizeMethod(typ.ptr, m, f);
            });
            $methodSet($ptrType(f.typ)).forEach(function(m) {
              synthesizeMethod(typ.ptr, m, f);
            });
          }
        });
      });
    };
    break;

  default:
    $panic(new $String("invalid kind: " + kind));
  }

  switch (kind) {
  case $kindBool:
  case $kindMap:
    typ.zero = function() { return false; };
    break;

  case $kindInt:
  case $kindInt8:
  case $kindInt16:
  case $kindInt32:
  case $kindUint:
  case $kindUint8 :
  case $kindUint16:
  case $kindUint32:
  case $kindUintptr:
  case $kindUnsafePointer:
  case $kindFloat32:
  case $kindFloat64:
    typ.zero = function() { return 0; };
    break;

  case $kindString:
    typ.zero = function() { return ""; };
    break;

  case $kindInt64:
  case $kindUint64:
  case $kindComplex64:
  case $kindComplex128:
    var zero = new typ(0, 0);
    typ.zero = function() { return zero; };
    break;

  case $kindPtr:
  case $kindSlice:
    typ.zero = function() { return typ.nil; };
    break;

  case $kindChan:
    typ.zero = function() { return $chanNil; };
    break;

  case $kindFunc:
    typ.zero = function() { return $throwNilPointerError; };
    break;

  case $kindInterface:
    typ.zero = function() { return $ifaceNil; };
    break;

  case $kindArray:
    typ.zero = function() {
      var arrayClass = $nativeArray(typ.elem.kind);
      if (arrayClass !== Array) {
        return new arrayClass(typ.len);
      }
      var array = new Array(typ.len);
      for (var i = 0; i < typ.len; i++) {
        array[i] = typ.elem.zero();
      }
      return array;
    };
    break;

  case $kindStruct:
    typ.zero = function() { return new typ.ptr(); };
    break;

  default:
    $panic(new $String("invalid kind: " + kind));
  }

  typ.id = $typeIDCounter;
  $typeIDCounter++;
  typ.size = size;
  typ.kind = kind;
  typ.string = string;
  typ.typeName = name;
  typ.pkg = pkg;
  typ.methods = [];
  typ.methodSetCache = null;
  typ.comparable = true;
  return typ;
};

var $methodSet = function(typ) {
  if (typ.methodSetCache !== null) {
    return typ.methodSetCache;
  }
  var base = {};

  var isPtr = (typ.kind === $kindPtr);
  if (isPtr && typ.elem.kind === $kindInterface) {
    typ.methodSetCache = [];
    return [];
  }

  var current = [{typ: isPtr ? typ.elem : typ, indirect: isPtr}];

  var seen = {};

  while (current.length > 0) {
    var next = [];
    var mset = [];

    current.forEach(function(e) {
      if (seen[e.typ.string]) {
        return;
      }
      seen[e.typ.string] = true;

      if(e.typ.typeName !== "") {
        mset = mset.concat(e.typ.methods);
        if (e.indirect) {
          mset = mset.concat($ptrType(e.typ).methods);
        }
      }

      switch (e.typ.kind) {
      case $kindStruct:
        e.typ.fields.forEach(function(f) {
          if (f.name === "") {
            var fTyp = f.typ;
            var fIsPtr = (fTyp.kind === $kindPtr);
            next.push({typ: fIsPtr ? fTyp.elem : fTyp, indirect: e.indirect || fIsPtr});
          }
        });
        break;

      case $kindInterface:
        mset = mset.concat(e.typ.methods);
        break;
      }
    });

    mset.forEach(function(m) {
      if (base[m.name] === undefined) {
        base[m.name] = m;
      }
    });

    current = next;
  }

  typ.methodSetCache = [];
  Object.keys(base).sort().forEach(function(name) {
    typ.methodSetCache.push(base[name]);
  });
  return typ.methodSetCache;
};

var $Bool          = $newType( 1, $kindBool,          "bool",           "bool",       "", null);
var $Int           = $newType( 4, $kindInt,           "int",            "int",        "", null);
var $Int8          = $newType( 1, $kindInt8,          "int8",           "int8",       "", null);
var $Int16         = $newType( 2, $kindInt16,         "int16",          "int16",      "", null);
var $Int32         = $newType( 4, $kindInt32,         "int32",          "int32",      "", null);
var $Int64         = $newType( 8, $kindInt64,         "int64",          "int64",      "", null);
var $Uint          = $newType( 4, $kindUint,          "uint",           "uint",       "", null);
var $Uint8         = $newType( 1, $kindUint8,         "uint8",          "uint8",      "", null);
var $Uint16        = $newType( 2, $kindUint16,        "uint16",         "uint16",     "", null);
var $Uint32        = $newType( 4, $kindUint32,        "uint32",         "uint32",     "", null);
var $Uint64        = $newType( 8, $kindUint64,        "uint64",         "uint64",     "", null);
var $Uintptr       = $newType( 4, $kindUintptr,       "uintptr",        "uintptr",    "", null);
var $Float32       = $newType( 4, $kindFloat32,       "float32",        "float32",    "", null);
var $Float64       = $newType( 8, $kindFloat64,       "float64",        "float64",    "", null);
var $Complex64     = $newType( 8, $kindComplex64,     "complex64",      "complex64",  "", null);
var $Complex128    = $newType(16, $kindComplex128,    "complex128",     "complex128", "", null);
var $String        = $newType( 8, $kindString,        "string",         "string",     "", null);
var $UnsafePointer = $newType( 4, $kindUnsafePointer, "unsafe.Pointer", "Pointer",    "", null);

var $nativeArray = function(elemKind) {
  switch (elemKind) {
  case $kindInt:
    return Int32Array;
  case $kindInt8:
    return Int8Array;
  case $kindInt16:
    return Int16Array;
  case $kindInt32:
    return Int32Array;
  case $kindUint:
    return Uint32Array;
  case $kindUint8:
    return Uint8Array;
  case $kindUint16:
    return Uint16Array;
  case $kindUint32:
    return Uint32Array;
  case $kindUintptr:
    return Uint32Array;
  case $kindFloat32:
    return Float32Array;
  case $kindFloat64:
    return Float64Array;
  default:
    return Array;
  }
};
var $toNativeArray = function(elemKind, array) {
  var nativeArray = $nativeArray(elemKind);
  if (nativeArray === Array) {
    return array;
  }
  return new nativeArray(array);
};
var $arrayTypes = {};
var $arrayType = function(elem, len) {
  var typeKey = elem.id + "$" + len;
  var typ = $arrayTypes[typeKey];
  if (typ === undefined) {
    typ = $newType(12, $kindArray, "[" + len + "]" + elem.string, "", "", null);
    $arrayTypes[typeKey] = typ;
    typ.init(elem, len);
  }
  return typ;
};

var $chanType = function(elem, sendOnly, recvOnly) {
  var string = (recvOnly ? "<-" : "") + "chan" + (sendOnly ? "<- " : " ") + elem.string;
  var field = sendOnly ? "SendChan" : (recvOnly ? "RecvChan" : "Chan");
  var typ = elem[field];
  if (typ === undefined) {
    typ = $newType(4, $kindChan, string, "", "", null);
    elem[field] = typ;
    typ.init(elem, sendOnly, recvOnly);
  }
  return typ;
};
var $Chan = function(elem, capacity) {
  if (capacity < 0 || capacity > 2147483647) {
    $throwRuntimeError("makechan: size out of range");
  }
  this.$elem = elem;
  this.$capacity = capacity;
  this.$buffer = [];
  this.$sendQueue = [];
  this.$recvQueue = [];
  this.$closed = false;
};
var $chanNil = new $Chan(null, 0);
$chanNil.$sendQueue = $chanNil.$recvQueue = { length: 0, push: function() {}, shift: function() { return undefined; }, indexOf: function() { return -1; } };

var $funcTypes = {};
var $funcType = function(params, results, variadic) {
  var typeKey = $mapArray(params, function(p) { return p.id; }).join(",") + "$" + $mapArray(results, function(r) { return r.id; }).join(",") + "$" + variadic;
  var typ = $funcTypes[typeKey];
  if (typ === undefined) {
    var paramTypes = $mapArray(params, function(p) { return p.string; });
    if (variadic) {
      paramTypes[paramTypes.length - 1] = "..." + paramTypes[paramTypes.length - 1].substr(2);
    }
    var string = "func(" + paramTypes.join(", ") + ")";
    if (results.length === 1) {
      string += " " + results[0].string;
    } else if (results.length > 1) {
      string += " (" + $mapArray(results, function(r) { return r.string; }).join(", ") + ")";
    }
    typ = $newType(4, $kindFunc, string, "", "", null);
    $funcTypes[typeKey] = typ;
    typ.init(params, results, variadic);
  }
  return typ;
};

var $interfaceTypes = {};
var $interfaceType = function(methods) {
  var typeKey = $mapArray(methods, function(m) { return m.pkg + "," + m.name + "," + m.typ.id; }).join("$");
  var typ = $interfaceTypes[typeKey];
  if (typ === undefined) {
    var string = "interface {}";
    if (methods.length !== 0) {
      string = "interface { " + $mapArray(methods, function(m) {
        return (m.pkg !== "" ? m.pkg + "." : "") + m.name + m.typ.string.substr(4);
      }).join("; ") + " }";
    }
    typ = $newType(8, $kindInterface, string, "", "", null);
    $interfaceTypes[typeKey] = typ;
    typ.init(methods);
  }
  return typ;
};
var $emptyInterface = $interfaceType([]);
var $ifaceNil = {};
var $error = $newType(8, $kindInterface, "error", "error", "", null);
$error.init([{prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}]);

var $mapTypes = {};
var $mapType = function(key, elem) {
  var typeKey = key.id + "$" + elem.id;
  var typ = $mapTypes[typeKey];
  if (typ === undefined) {
    typ = $newType(4, $kindMap, "map[" + key.string + "]" + elem.string, "", "", null);
    $mapTypes[typeKey] = typ;
    typ.init(key, elem);
  }
  return typ;
};
var $makeMap = function(keyForFunc, entries) {
  var m = {};
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    m[keyForFunc(e.k)] = e;
  }
  return m;
};

var $ptrType = function(elem) {
  var typ = elem.ptr;
  if (typ === undefined) {
    typ = $newType(4, $kindPtr, "*" + elem.string, "", "", null);
    elem.ptr = typ;
    typ.init(elem);
  }
  return typ;
};

var $newDataPointer = function(data, constructor) {
  if (constructor.elem.kind === $kindStruct) {
    return data;
  }
  return new constructor(function() { return data; }, function(v) { data = v; });
};

var $indexPtr = function(array, index, constructor) {
  array.$ptr = array.$ptr || {};
  return array.$ptr[index] || (array.$ptr[index] = new constructor(function() { return array[index]; }, function(v) { array[index] = v; }));
};

var $sliceType = function(elem) {
  var typ = elem.slice;
  if (typ === undefined) {
    typ = $newType(12, $kindSlice, "[]" + elem.string, "", "", null);
    elem.slice = typ;
    typ.init(elem);
  }
  return typ;
};
var $makeSlice = function(typ, length, capacity) {
  capacity = capacity || length;
  if (length < 0 || length > 2147483647) {
    $throwRuntimeError("makeslice: len out of range");
  }
  if (capacity < 0 || capacity < length || capacity > 2147483647) {
    $throwRuntimeError("makeslice: cap out of range");
  }
  var array = new typ.nativeArray(capacity);
  if (typ.nativeArray === Array) {
    for (var i = 0; i < capacity; i++) {
      array[i] = typ.elem.zero();
    }
  }
  var slice = new typ(array);
  slice.$length = length;
  return slice;
};

var $structTypes = {};
var $structType = function(fields) {
  var typeKey = $mapArray(fields, function(f) { return f.name + "," + f.typ.id + "," + f.tag; }).join("$");
  var typ = $structTypes[typeKey];
  if (typ === undefined) {
    var string = "struct { " + $mapArray(fields, function(f) {
      return f.name + " " + f.typ.string + (f.tag !== "" ? (" \"" + f.tag.replace(/\\/g, "\\\\").replace(/"/g, "\\\"") + "\"") : "");
    }).join("; ") + " }";
    if (fields.length === 0) {
      string = "struct {}";
    }
    typ = $newType(0, $kindStruct, string, "", "", function() {
      this.$val = this;
      for (var i = 0; i < fields.length; i++) {
        var f = fields[i];
        var arg = arguments[i];
        this[f.prop] = arg !== undefined ? arg : f.typ.zero();
      }
    });
    $structTypes[typeKey] = typ;
    typ.init(fields);
  }
  return typ;
};

var $assertType = function(value, type, returnTuple) {
  var isInterface = (type.kind === $kindInterface), ok, missingMethod = "";
  if (value === $ifaceNil) {
    ok = false;
  } else if (!isInterface) {
    ok = value.constructor === type;
  } else {
    var valueTypeString = value.constructor.string;
    ok = type.implementedBy[valueTypeString];
    if (ok === undefined) {
      ok = true;
      var valueMethodSet = $methodSet(value.constructor);
      var interfaceMethods = type.methods;
      for (var i = 0; i < interfaceMethods.length; i++) {
        var tm = interfaceMethods[i];
        var found = false;
        for (var j = 0; j < valueMethodSet.length; j++) {
          var vm = valueMethodSet[j];
          if (vm.name === tm.name && vm.pkg === tm.pkg && vm.typ === tm.typ) {
            found = true;
            break;
          }
        }
        if (!found) {
          ok = false;
          type.missingMethodFor[valueTypeString] = tm.name;
          break;
        }
      }
      type.implementedBy[valueTypeString] = ok;
    }
    if (!ok) {
      missingMethod = type.missingMethodFor[valueTypeString];
    }
  }

  if (!ok) {
    if (returnTuple) {
      return [type.zero(), false];
    }
    $panic(new $packages["runtime"].TypeAssertionError.ptr("", (value === $ifaceNil ? "" : value.constructor.string), type.string, missingMethod));
  }

  if (!isInterface) {
    value = value.$val;
  }
  if (type === $jsObjectPtr) {
    value = value.object;
  }
  return returnTuple ? [value, true] : value;
};

var $stackDepthOffset = 0;
var $getStackDepth = function() {
  var err = new Error();
  if (err.stack === undefined) {
    return undefined;
  }
  return $stackDepthOffset + err.stack.split("\n").length;
};

var $panicStackDepth = null, $panicValue;
var $callDeferred = function(deferred, jsErr, fromPanic) {
  if (!fromPanic && deferred !== null && deferred.index >= $curGoroutine.deferStack.length) {
    throw jsErr;
  }
  if (jsErr !== null) {
    var newErr = null;
    try {
      $curGoroutine.deferStack.push(deferred);
      $panic(new $jsErrorPtr(jsErr));
    } catch (err) {
      newErr = err;
    }
    $curGoroutine.deferStack.pop();
    $callDeferred(deferred, newErr);
    return;
  }
  if ($curGoroutine.asleep) {
    return;
  }

  $stackDepthOffset--;
  var outerPanicStackDepth = $panicStackDepth;
  var outerPanicValue = $panicValue;

  var localPanicValue = $curGoroutine.panicStack.pop();
  if (localPanicValue !== undefined) {
    $panicStackDepth = $getStackDepth();
    $panicValue = localPanicValue;
  }

  try {
    while (true) {
      if (deferred === null) {
        deferred = $curGoroutine.deferStack[$curGoroutine.deferStack.length - 1];
        if (deferred === undefined) {
          /* The panic reached the top of the stack. Clear it and throw it as a JavaScript error. */
          $panicStackDepth = null;
          if (localPanicValue.Object instanceof Error) {
            throw localPanicValue.Object;
          }
          var msg;
          if (localPanicValue.constructor === $String) {
            msg = localPanicValue.$val;
          } else if (localPanicValue.Error !== undefined) {
            msg = localPanicValue.Error();
          } else if (localPanicValue.String !== undefined) {
            msg = localPanicValue.String();
          } else {
            msg = localPanicValue;
          }
          throw new Error(msg);
        }
      }
      var call = deferred.pop();
      if (call === undefined) {
        $curGoroutine.deferStack.pop();
        if (localPanicValue !== undefined) {
          deferred = null;
          continue;
        }
        return;
      }
      var r = call[0].apply(call[2], call[1]);
      if (r && r.$blk !== undefined) {
        deferred.push([r.$blk, [], r]);
        if (fromPanic) {
          throw null;
        }
        return;
      }

      if (localPanicValue !== undefined && $panicStackDepth === null) {
        throw null; /* error was recovered */
      }
    }
  } finally {
    if (localPanicValue !== undefined) {
      if ($panicStackDepth !== null) {
        $curGoroutine.panicStack.push(localPanicValue);
      }
      $panicStackDepth = outerPanicStackDepth;
      $panicValue = outerPanicValue;
    }
    $stackDepthOffset++;
  }
};

var $panic = function(value) {
  $curGoroutine.panicStack.push(value);
  $callDeferred(null, null, true);
};
var $recover = function() {
  if ($panicStackDepth === null || ($panicStackDepth !== undefined && $panicStackDepth !== $getStackDepth() - 2)) {
    return $ifaceNil;
  }
  $panicStackDepth = null;
  return $panicValue;
};
var $throw = function(err) { throw err; };

var $dummyGoroutine = { asleep: false, exit: false, deferStack: [], panicStack: [], canBlock: false };
var $curGoroutine = $dummyGoroutine, $totalGoroutines = 0, $awakeGoroutines = 0, $checkForDeadlock = true;
var $mainFinished = false;
var $go = function(fun, args, direct) {
  $totalGoroutines++;
  $awakeGoroutines++;
  var $goroutine = function() {
    try {
      $curGoroutine = $goroutine;
      var r = fun.apply(undefined, args);
      if (r && r.$blk !== undefined) {
        fun = function() { return r.$blk(); };
        args = [];
        return;
      }
      $goroutine.exit = true;
    } catch (err) {
      if (!$goroutine.exit) {
        throw err;
      }
    } finally {
      $curGoroutine = $dummyGoroutine;
      if ($goroutine.exit) { /* also set by runtime.Goexit() */
        $totalGoroutines--;
        $goroutine.asleep = true;
      }
      if ($goroutine.asleep) {
        $awakeGoroutines--;
        if (!$mainFinished && $awakeGoroutines === 0 && $checkForDeadlock) {
          console.error("fatal error: all goroutines are asleep - deadlock!");
          if ($global.process !== undefined) {
            $global.process.exit(2);
          }
        }
      }
    }
  };
  $goroutine.asleep = false;
  $goroutine.exit = false;
  $goroutine.deferStack = [];
  $goroutine.panicStack = [];
  $goroutine.canBlock = true;
  $schedule($goroutine, direct);
};

var $scheduled = [], $schedulerActive = false;
var $runScheduled = function() {
  try {
    var r;
    while ((r = $scheduled.shift()) !== undefined) {
      r();
    }
    $schedulerActive = false;
  } finally {
    if ($schedulerActive) {
      setTimeout($runScheduled, 0);
    }
  }
};
var $schedule = function(goroutine, direct) {
  if (goroutine.asleep) {
    goroutine.asleep = false;
    $awakeGoroutines++;
  }

  if (direct) {
    goroutine();
    return;
  }

  $scheduled.push(goroutine);
  if (!$schedulerActive) {
    $schedulerActive = true;
    setTimeout($runScheduled, 0);
  }
};

var $setTimeout = function(f, t) {
  $awakeGoroutines++;
  return setTimeout(function() {
    $awakeGoroutines--;
    f();
  }, t);
};

var $block = function() {
  if (!$curGoroutine.canBlock) {
    $throwRuntimeError("cannot block in JavaScript callback, fix by wrapping code in goroutine");
  }
  $curGoroutine.asleep = true;
};

var $send = function(chan, value) {
  if (chan.$closed) {
    $throwRuntimeError("send on closed channel");
  }
  var queuedRecv = chan.$recvQueue.shift();
  if (queuedRecv !== undefined) {
    queuedRecv([value, true]);
    return;
  }
  if (chan.$buffer.length < chan.$capacity) {
    chan.$buffer.push(value);
    return;
  }

  var thisGoroutine = $curGoroutine;
  chan.$sendQueue.push(function() {
    $schedule(thisGoroutine);
    return value;
  });
  $block();
  return {
    $blk: function() {
      if (chan.$closed) {
        $throwRuntimeError("send on closed channel");
      }
    }
  };
};
var $recv = function(chan) {
  var queuedSend = chan.$sendQueue.shift();
  if (queuedSend !== undefined) {
    chan.$buffer.push(queuedSend());
  }
  var bufferedValue = chan.$buffer.shift();
  if (bufferedValue !== undefined) {
    return [bufferedValue, true];
  }
  if (chan.$closed) {
    return [chan.$elem.zero(), false];
  }

  var thisGoroutine = $curGoroutine;
  var f = { $blk: function() { return this.value; } };
  var queueEntry = function(v) {
    f.value = v;
    $schedule(thisGoroutine);
  };
  chan.$recvQueue.push(queueEntry);
  $block();
  return f;
};
var $close = function(chan) {
  if (chan.$closed) {
    $throwRuntimeError("close of closed channel");
  }
  chan.$closed = true;
  while (true) {
    var queuedSend = chan.$sendQueue.shift();
    if (queuedSend === undefined) {
      break;
    }
    queuedSend(); /* will panic because of closed channel */
  }
  while (true) {
    var queuedRecv = chan.$recvQueue.shift();
    if (queuedRecv === undefined) {
      break;
    }
    queuedRecv([chan.$elem.zero(), false]);
  }
};
var $select = function(comms) {
  var ready = [];
  var selection = -1;
  for (var i = 0; i < comms.length; i++) {
    var comm = comms[i];
    var chan = comm[0];
    switch (comm.length) {
    case 0: /* default */
      selection = i;
      break;
    case 1: /* recv */
      if (chan.$sendQueue.length !== 0 || chan.$buffer.length !== 0 || chan.$closed) {
        ready.push(i);
      }
      break;
    case 2: /* send */
      if (chan.$closed) {
        $throwRuntimeError("send on closed channel");
      }
      if (chan.$recvQueue.length !== 0 || chan.$buffer.length < chan.$capacity) {
        ready.push(i);
      }
      break;
    }
  }

  if (ready.length !== 0) {
    selection = ready[Math.floor(Math.random() * ready.length)];
  }
  if (selection !== -1) {
    var comm = comms[selection];
    switch (comm.length) {
    case 0: /* default */
      return [selection];
    case 1: /* recv */
      return [selection, $recv(comm[0])];
    case 2: /* send */
      $send(comm[0], comm[1]);
      return [selection];
    }
  }

  var entries = [];
  var thisGoroutine = $curGoroutine;
  var f = { $blk: function() { return this.selection; } };
  var removeFromQueues = function() {
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      var queue = entry[0];
      var index = queue.indexOf(entry[1]);
      if (index !== -1) {
        queue.splice(index, 1);
      }
    }
  };
  for (var i = 0; i < comms.length; i++) {
    (function(i) {
      var comm = comms[i];
      switch (comm.length) {
      case 1: /* recv */
        var queueEntry = function(value) {
          f.selection = [i, value];
          removeFromQueues();
          $schedule(thisGoroutine);
        };
        entries.push([comm[0].$recvQueue, queueEntry]);
        comm[0].$recvQueue.push(queueEntry);
        break;
      case 2: /* send */
        var queueEntry = function() {
          if (comm[0].$closed) {
            $throwRuntimeError("send on closed channel");
          }
          f.selection = [i];
          removeFromQueues();
          $schedule(thisGoroutine);
          return comm[1];
        };
        entries.push([comm[0].$sendQueue, queueEntry]);
        comm[0].$sendQueue.push(queueEntry);
        break;
      }
    })(i);
  }
  $block();
  return f;
};

var $jsObjectPtr, $jsErrorPtr;

var $needsExternalization = function(t) {
  switch (t.kind) {
    case $kindBool:
    case $kindInt:
    case $kindInt8:
    case $kindInt16:
    case $kindInt32:
    case $kindUint:
    case $kindUint8:
    case $kindUint16:
    case $kindUint32:
    case $kindUintptr:
    case $kindFloat32:
    case $kindFloat64:
      return false;
    default:
      return t !== $jsObjectPtr;
  }
};

var $externalize = function(v, t) {
  if (t === $jsObjectPtr) {
    return v;
  }
  switch (t.kind) {
  case $kindBool:
  case $kindInt:
  case $kindInt8:
  case $kindInt16:
  case $kindInt32:
  case $kindUint:
  case $kindUint8:
  case $kindUint16:
  case $kindUint32:
  case $kindUintptr:
  case $kindFloat32:
  case $kindFloat64:
    return v;
  case $kindInt64:
  case $kindUint64:
    return $flatten64(v);
  case $kindArray:
    if ($needsExternalization(t.elem)) {
      return $mapArray(v, function(e) { return $externalize(e, t.elem); });
    }
    return v;
  case $kindFunc:
    return $externalizeFunction(v, t, false);
  case $kindInterface:
    if (v === $ifaceNil) {
      return null;
    }
    if (v.constructor === $jsObjectPtr) {
      return v.$val.object;
    }
    return $externalize(v.$val, v.constructor);
  case $kindMap:
    var m = {};
    var keys = $keys(v);
    for (var i = 0; i < keys.length; i++) {
      var entry = v[keys[i]];
      m[$externalize(entry.k, t.key)] = $externalize(entry.v, t.elem);
    }
    return m;
  case $kindPtr:
    if (v === t.nil) {
      return null;
    }
    return $externalize(v.$get(), t.elem);
  case $kindSlice:
    if ($needsExternalization(t.elem)) {
      return $mapArray($sliceToArray(v), function(e) { return $externalize(e, t.elem); });
    }
    return $sliceToArray(v);
  case $kindString:
    if (v.search(/^[\x00-\x7F]*$/) !== -1) {
      return v;
    }
    var s = "", r;
    for (var i = 0; i < v.length; i += r[1]) {
      r = $decodeRune(v, i);
      var c = r[0];
      if (c > 0xFFFF) {
        var h = Math.floor((c - 0x10000) / 0x400) + 0xD800;
        var l = (c - 0x10000) % 0x400 + 0xDC00;
        s += String.fromCharCode(h, l);
        continue;
      }
      s += String.fromCharCode(c);
    }
    return s;
  case $kindStruct:
    var timePkg = $packages["time"];
    if (timePkg !== undefined && v.constructor === timePkg.Time.ptr) {
      var milli = $div64(v.UnixNano(), new $Int64(0, 1000000));
      return new Date($flatten64(milli));
    }

    var noJsObject = {};
    var searchJsObject = function(v, t) {
      if (t === $jsObjectPtr) {
        return v;
      }
      switch (t.kind) {
      case $kindPtr:
        if (v === t.nil) {
          return noJsObject;
        }
        return searchJsObject(v.$get(), t.elem);
      case $kindStruct:
        var f = t.fields[0];
        return searchJsObject(v[f.prop], f.typ);
      case $kindInterface:
        return searchJsObject(v.$val, v.constructor);
      default:
        return noJsObject;
      }
    };
    var o = searchJsObject(v, t);
    if (o !== noJsObject) {
      return o;
    }

    o = {};
    for (var i = 0; i < t.fields.length; i++) {
      var f = t.fields[i];
      if (f.pkg !== "") { /* not exported */
        continue;
      }
      o[f.name] = $externalize(v[f.prop], f.typ);
    }
    return o;
  }
  $throwRuntimeError("cannot externalize " + t.string);
};

var $externalizeFunction = function(v, t, passThis) {
  if (v === $throwNilPointerError) {
    return null;
  }
  if (v.$externalizeWrapper === undefined) {
    $checkForDeadlock = false;
    v.$externalizeWrapper = function() {
      var args = [];
      for (var i = 0; i < t.params.length; i++) {
        if (t.variadic && i === t.params.length - 1) {
          var vt = t.params[i].elem, varargs = [];
          for (var j = i; j < arguments.length; j++) {
            varargs.push($internalize(arguments[j], vt));
          }
          args.push(new (t.params[i])(varargs));
          break;
        }
        args.push($internalize(arguments[i], t.params[i]));
      }
      var canBlock = $curGoroutine.canBlock;
      $curGoroutine.canBlock = false;
      try {
        var result = v.apply(passThis ? this : undefined, args);
      } finally {
        $curGoroutine.canBlock = canBlock;
      }
      switch (t.results.length) {
      case 0:
        return;
      case 1:
        return $externalize(result, t.results[0]);
      default:
        for (var i = 0; i < t.results.length; i++) {
          result[i] = $externalize(result[i], t.results[i]);
        }
        return result;
      }
    };
  }
  return v.$externalizeWrapper;
};

var $internalize = function(v, t, recv) {
  if (t === $jsObjectPtr) {
    return v;
  }
  if (t === $jsObjectPtr.elem) {
    $throwRuntimeError("cannot internalize js.Object, use *js.Object instead");
  }
  if (v && v.__internal_object__ !== undefined) {
    return $assertType(v.__internal_object__, t, false);
  }
  var timePkg = $packages["time"];
  if (timePkg !== undefined && t === timePkg.Time) {
    if (!(v !== null && v !== undefined && v.constructor === Date)) {
      $throwRuntimeError("cannot internalize time.Time from " + typeof v + ", must be Date");
    }
    return timePkg.Unix(new $Int64(0, 0), new $Int64(0, v.getTime() * 1000000));
  }
  switch (t.kind) {
  case $kindBool:
    return !!v;
  case $kindInt:
    return parseInt(v);
  case $kindInt8:
    return parseInt(v) << 24 >> 24;
  case $kindInt16:
    return parseInt(v) << 16 >> 16;
  case $kindInt32:
    return parseInt(v) >> 0;
  case $kindUint:
    return parseInt(v);
  case $kindUint8:
    return parseInt(v) << 24 >>> 24;
  case $kindUint16:
    return parseInt(v) << 16 >>> 16;
  case $kindUint32:
  case $kindUintptr:
    return parseInt(v) >>> 0;
  case $kindInt64:
  case $kindUint64:
    return new t(0, v);
  case $kindFloat32:
  case $kindFloat64:
    return parseFloat(v);
  case $kindArray:
    if (v.length !== t.len) {
      $throwRuntimeError("got array with wrong size from JavaScript native");
    }
    return $mapArray(v, function(e) { return $internalize(e, t.elem); });
  case $kindFunc:
    return function() {
      var args = [];
      for (var i = 0; i < t.params.length; i++) {
        if (t.variadic && i === t.params.length - 1) {
          var vt = t.params[i].elem, varargs = arguments[i];
          for (var j = 0; j < varargs.$length; j++) {
            args.push($externalize(varargs.$array[varargs.$offset + j], vt));
          }
          break;
        }
        args.push($externalize(arguments[i], t.params[i]));
      }
      var result = v.apply(recv, args);
      switch (t.results.length) {
      case 0:
        return;
      case 1:
        return $internalize(result, t.results[0]);
      default:
        for (var i = 0; i < t.results.length; i++) {
          result[i] = $internalize(result[i], t.results[i]);
        }
        return result;
      }
    };
  case $kindInterface:
    if (t.methods.length !== 0) {
      $throwRuntimeError("cannot internalize " + t.string);
    }
    if (v === null) {
      return $ifaceNil;
    }
    if (v === undefined) {
      return new $jsObjectPtr(undefined);
    }
    switch (v.constructor) {
    case Int8Array:
      return new ($sliceType($Int8))(v);
    case Int16Array:
      return new ($sliceType($Int16))(v);
    case Int32Array:
      return new ($sliceType($Int))(v);
    case Uint8Array:
      return new ($sliceType($Uint8))(v);
    case Uint16Array:
      return new ($sliceType($Uint16))(v);
    case Uint32Array:
      return new ($sliceType($Uint))(v);
    case Float32Array:
      return new ($sliceType($Float32))(v);
    case Float64Array:
      return new ($sliceType($Float64))(v);
    case Array:
      return $internalize(v, $sliceType($emptyInterface));
    case Boolean:
      return new $Bool(!!v);
    case Date:
      if (timePkg === undefined) {
        /* time package is not present, internalize as &js.Object{Date} so it can be externalized into original Date. */
        return new $jsObjectPtr(v);
      }
      return new timePkg.Time($internalize(v, timePkg.Time));
    case Function:
      var funcType = $funcType([$sliceType($emptyInterface)], [$jsObjectPtr], true);
      return new funcType($internalize(v, funcType));
    case Number:
      return new $Float64(parseFloat(v));
    case String:
      return new $String($internalize(v, $String));
    default:
      if ($global.Node && v instanceof $global.Node) {
        return new $jsObjectPtr(v);
      }
      var mapType = $mapType($String, $emptyInterface);
      return new mapType($internalize(v, mapType));
    }
  case $kindMap:
    var m = {};
    var keys = $keys(v);
    for (var i = 0; i < keys.length; i++) {
      var k = $internalize(keys[i], t.key);
      m[t.key.keyFor(k)] = { k: k, v: $internalize(v[keys[i]], t.elem) };
    }
    return m;
  case $kindPtr:
    if (t.elem.kind === $kindStruct) {
      return $internalize(v, t.elem);
    }
  case $kindSlice:
    return new t($mapArray(v, function(e) { return $internalize(e, t.elem); }));
  case $kindString:
    v = String(v);
    if (v.search(/^[\x00-\x7F]*$/) !== -1) {
      return v;
    }
    var s = "";
    var i = 0;
    while (i < v.length) {
      var h = v.charCodeAt(i);
      if (0xD800 <= h && h <= 0xDBFF) {
        var l = v.charCodeAt(i + 1);
        var c = (h - 0xD800) * 0x400 + l - 0xDC00 + 0x10000;
        s += $encodeRune(c);
        i += 2;
        continue;
      }
      s += $encodeRune(h);
      i++;
    }
    return s;
  case $kindStruct:
    var noJsObject = {};
    var searchJsObject = function(t) {
      if (t === $jsObjectPtr) {
        return v;
      }
      if (t === $jsObjectPtr.elem) {
        $throwRuntimeError("cannot internalize js.Object, use *js.Object instead");
      }
      switch (t.kind) {
      case $kindPtr:
        return searchJsObject(t.elem);
      case $kindStruct:
        var f = t.fields[0];
        var o = searchJsObject(f.typ);
        if (o !== noJsObject) {
          var n = new t.ptr();
          n[f.prop] = o;
          return n;
        }
        return noJsObject;
      default:
        return noJsObject;
      }
    };
    var o = searchJsObject(t);
    if (o !== noJsObject) {
      return o;
    }
  }
  $throwRuntimeError("cannot internalize " + t.string);
};

$packages["github.com/gopherjs/gopherjs/js"] = (function() {
	var $pkg = {}, $init, Object, Error, M, sliceType, ptrType, ptrType$1, init;
	Object = $pkg.Object = $newType(0, $kindStruct, "js.Object", "Object", "github.com/gopherjs/gopherjs/js", function(object_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.object = null;
			return;
		}
		this.object = object_;
	});
	Error = $pkg.Error = $newType(0, $kindStruct, "js.Error", "Error", "github.com/gopherjs/gopherjs/js", function(Object_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Object = null;
			return;
		}
		this.Object = Object_;
	});
	M = $pkg.M = $newType(4, $kindMap, "js.M", "M", "github.com/gopherjs/gopherjs/js", null);
	sliceType = $sliceType($emptyInterface);
	ptrType = $ptrType(Object);
	ptrType$1 = $ptrType(Error);
	Object.ptr.prototype.Get = function(key) {
		var $ptr, key, o;
		o = this;
		return o.object[$externalize(key, $String)];
	};
	Object.prototype.Get = function(key) { return this.$val.Get(key); };
	Object.ptr.prototype.Set = function(key, value) {
		var $ptr, key, o, value;
		o = this;
		o.object[$externalize(key, $String)] = $externalize(value, $emptyInterface);
	};
	Object.prototype.Set = function(key, value) { return this.$val.Set(key, value); };
	Object.ptr.prototype.Delete = function(key) {
		var $ptr, key, o;
		o = this;
		delete o.object[$externalize(key, $String)];
	};
	Object.prototype.Delete = function(key) { return this.$val.Delete(key); };
	Object.ptr.prototype.Length = function() {
		var $ptr, o;
		o = this;
		return $parseInt(o.object.length);
	};
	Object.prototype.Length = function() { return this.$val.Length(); };
	Object.ptr.prototype.Index = function(i) {
		var $ptr, i, o;
		o = this;
		return o.object[i];
	};
	Object.prototype.Index = function(i) { return this.$val.Index(i); };
	Object.ptr.prototype.SetIndex = function(i, value) {
		var $ptr, i, o, value;
		o = this;
		o.object[i] = $externalize(value, $emptyInterface);
	};
	Object.prototype.SetIndex = function(i, value) { return this.$val.SetIndex(i, value); };
	Object.ptr.prototype.Call = function(name, args) {
		var $ptr, args, name, o, obj;
		o = this;
		return (obj = o.object, obj[$externalize(name, $String)].apply(obj, $externalize(args, sliceType)));
	};
	Object.prototype.Call = function(name, args) { return this.$val.Call(name, args); };
	Object.ptr.prototype.Invoke = function(args) {
		var $ptr, args, o;
		o = this;
		return o.object.apply(undefined, $externalize(args, sliceType));
	};
	Object.prototype.Invoke = function(args) { return this.$val.Invoke(args); };
	Object.ptr.prototype.New = function(args) {
		var $ptr, args, o;
		o = this;
		return new ($global.Function.prototype.bind.apply(o.object, [undefined].concat($externalize(args, sliceType))));
	};
	Object.prototype.New = function(args) { return this.$val.New(args); };
	Object.ptr.prototype.Bool = function() {
		var $ptr, o;
		o = this;
		return !!(o.object);
	};
	Object.prototype.Bool = function() { return this.$val.Bool(); };
	Object.ptr.prototype.String = function() {
		var $ptr, o;
		o = this;
		return $internalize(o.object, $String);
	};
	Object.prototype.String = function() { return this.$val.String(); };
	Object.ptr.prototype.Int = function() {
		var $ptr, o;
		o = this;
		return $parseInt(o.object) >> 0;
	};
	Object.prototype.Int = function() { return this.$val.Int(); };
	Object.ptr.prototype.Int64 = function() {
		var $ptr, o;
		o = this;
		return $internalize(o.object, $Int64);
	};
	Object.prototype.Int64 = function() { return this.$val.Int64(); };
	Object.ptr.prototype.Uint64 = function() {
		var $ptr, o;
		o = this;
		return $internalize(o.object, $Uint64);
	};
	Object.prototype.Uint64 = function() { return this.$val.Uint64(); };
	Object.ptr.prototype.Float = function() {
		var $ptr, o;
		o = this;
		return $parseFloat(o.object);
	};
	Object.prototype.Float = function() { return this.$val.Float(); };
	Object.ptr.prototype.Interface = function() {
		var $ptr, o;
		o = this;
		return $internalize(o.object, $emptyInterface);
	};
	Object.prototype.Interface = function() { return this.$val.Interface(); };
	Object.ptr.prototype.Unsafe = function() {
		var $ptr, o;
		o = this;
		return o.object;
	};
	Object.prototype.Unsafe = function() { return this.$val.Unsafe(); };
	Error.ptr.prototype.Error = function() {
		var $ptr, err;
		err = this;
		return "JavaScript error: " + $internalize(err.Object.message, $String);
	};
	Error.prototype.Error = function() { return this.$val.Error(); };
	Error.ptr.prototype.Stack = function() {
		var $ptr, err;
		err = this;
		return $internalize(err.Object.stack, $String);
	};
	Error.prototype.Stack = function() { return this.$val.Stack(); };
	init = function() {
		var $ptr, e;
		e = new Error.ptr(null);
	};
	ptrType.methods = [{prop: "Get", name: "Get", pkg: "", typ: $funcType([$String], [ptrType], false)}, {prop: "Set", name: "Set", pkg: "", typ: $funcType([$String, $emptyInterface], [], false)}, {prop: "Delete", name: "Delete", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Length", name: "Length", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Index", name: "Index", pkg: "", typ: $funcType([$Int], [ptrType], false)}, {prop: "SetIndex", name: "SetIndex", pkg: "", typ: $funcType([$Int, $emptyInterface], [], false)}, {prop: "Call", name: "Call", pkg: "", typ: $funcType([$String, sliceType], [ptrType], true)}, {prop: "Invoke", name: "Invoke", pkg: "", typ: $funcType([sliceType], [ptrType], true)}, {prop: "New", name: "New", pkg: "", typ: $funcType([sliceType], [ptrType], true)}, {prop: "Bool", name: "Bool", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Int", name: "Int", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Int64", name: "Int64", pkg: "", typ: $funcType([], [$Int64], false)}, {prop: "Uint64", name: "Uint64", pkg: "", typ: $funcType([], [$Uint64], false)}, {prop: "Float", name: "Float", pkg: "", typ: $funcType([], [$Float64], false)}, {prop: "Interface", name: "Interface", pkg: "", typ: $funcType([], [$emptyInterface], false)}, {prop: "Unsafe", name: "Unsafe", pkg: "", typ: $funcType([], [$Uintptr], false)}];
	ptrType$1.methods = [{prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Stack", name: "Stack", pkg: "", typ: $funcType([], [$String], false)}];
	Object.init([{prop: "object", name: "object", pkg: "github.com/gopherjs/gopherjs/js", typ: ptrType, tag: ""}]);
	Error.init([{prop: "Object", name: "", pkg: "", typ: ptrType, tag: ""}]);
	M.init($String, $emptyInterface);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		init();
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["runtime/internal/sys"] = (function() {
	var $pkg = {}, $init;
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["runtime"] = (function() {
	var $pkg = {}, $init, js, sys, TypeAssertionError, errorString, ptrType$4, init;
	js = $packages["github.com/gopherjs/gopherjs/js"];
	sys = $packages["runtime/internal/sys"];
	TypeAssertionError = $pkg.TypeAssertionError = $newType(0, $kindStruct, "runtime.TypeAssertionError", "TypeAssertionError", "runtime", function(interfaceString_, concreteString_, assertedString_, missingMethod_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.interfaceString = "";
			this.concreteString = "";
			this.assertedString = "";
			this.missingMethod = "";
			return;
		}
		this.interfaceString = interfaceString_;
		this.concreteString = concreteString_;
		this.assertedString = assertedString_;
		this.missingMethod = missingMethod_;
	});
	errorString = $pkg.errorString = $newType(8, $kindString, "runtime.errorString", "errorString", "runtime", null);
	ptrType$4 = $ptrType(TypeAssertionError);
	init = function() {
		var $ptr, e, jsPkg;
		jsPkg = $packages[$externalize("github.com/gopherjs/gopherjs/js", $String)];
		$jsObjectPtr = jsPkg.Object.ptr;
		$jsErrorPtr = jsPkg.Error.ptr;
		$throwRuntimeError = (function(msg) {
			var $ptr, msg;
			$panic(new errorString(msg));
		});
		e = $ifaceNil;
		e = new TypeAssertionError.ptr("", "", "", "");
	};
	TypeAssertionError.ptr.prototype.RuntimeError = function() {
		var $ptr;
	};
	TypeAssertionError.prototype.RuntimeError = function() { return this.$val.RuntimeError(); };
	TypeAssertionError.ptr.prototype.Error = function() {
		var $ptr, e, inter;
		e = this;
		inter = e.interfaceString;
		if (inter === "") {
			inter = "interface";
		}
		if (e.concreteString === "") {
			return "interface conversion: " + inter + " is nil, not " + e.assertedString;
		}
		if (e.missingMethod === "") {
			return "interface conversion: " + inter + " is " + e.concreteString + ", not " + e.assertedString;
		}
		return "interface conversion: " + e.concreteString + " is not " + e.assertedString + ": missing method " + e.missingMethod;
	};
	TypeAssertionError.prototype.Error = function() { return this.$val.Error(); };
	errorString.prototype.RuntimeError = function() {
		var $ptr, e;
		e = this.$val;
	};
	$ptrType(errorString).prototype.RuntimeError = function() { return new errorString(this.$get()).RuntimeError(); };
	errorString.prototype.Error = function() {
		var $ptr, e;
		e = this.$val;
		return "runtime error: " + e;
	};
	$ptrType(errorString).prototype.Error = function() { return new errorString(this.$get()).Error(); };
	ptrType$4.methods = [{prop: "RuntimeError", name: "RuntimeError", pkg: "", typ: $funcType([], [], false)}, {prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}];
	errorString.methods = [{prop: "RuntimeError", name: "RuntimeError", pkg: "", typ: $funcType([], [], false)}, {prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}];
	TypeAssertionError.init([{prop: "interfaceString", name: "interfaceString", pkg: "runtime", typ: $String, tag: ""}, {prop: "concreteString", name: "concreteString", pkg: "runtime", typ: $String, tag: ""}, {prop: "assertedString", name: "assertedString", pkg: "runtime", typ: $String, tag: ""}, {prop: "missingMethod", name: "missingMethod", pkg: "runtime", typ: $String, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = js.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = sys.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		init();
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["errors"] = (function() {
	var $pkg = {}, $init, errorString, ptrType, New;
	errorString = $pkg.errorString = $newType(0, $kindStruct, "errors.errorString", "errorString", "errors", function(s_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.s = "";
			return;
		}
		this.s = s_;
	});
	ptrType = $ptrType(errorString);
	New = function(text) {
		var $ptr, text;
		return new errorString.ptr(text);
	};
	$pkg.New = New;
	errorString.ptr.prototype.Error = function() {
		var $ptr, e;
		e = this;
		return e.s;
	};
	errorString.prototype.Error = function() { return this.$val.Error(); };
	ptrType.methods = [{prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}];
	errorString.init([{prop: "s", name: "s", pkg: "errors", typ: $String, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["sort"] = (function() {
	var $pkg = {}, $init, Search, SearchStrings;
	Search = function(n, f) {
		var $ptr, _q, _r, _tmp, _tmp$1, f, h, i, j, n, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _q = $f._q; _r = $f._r; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; f = $f.f; h = $f.h; i = $f.i; j = $f.j; n = $f.n; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_tmp = 0;
		_tmp$1 = n;
		i = _tmp;
		j = _tmp$1;
		/* while (true) { */ case 1:
			/* if (!(i < j)) { break; } */ if(!(i < j)) { $s = 2; continue; }
			h = i + (_q = ((j - i >> 0)) / 2, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero")) >> 0;
			_r = f(h); /* */ $s = 6; case 6: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			/* */ if (!_r) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (!_r) { */ case 3:
				i = h + 1 >> 0;
				$s = 5; continue;
			/* } else { */ case 4:
				j = h;
			/* } */ case 5:
		/* } */ $s = 1; continue; case 2:
		return i;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Search }; } $f.$ptr = $ptr; $f._q = _q; $f._r = _r; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f.f = f; $f.h = h; $f.i = i; $f.j = j; $f.n = n; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.Search = Search;
	SearchStrings = function(a, x) {
		var $ptr, _r, a, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; a = $f.a; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		a = [a];
		x = [x];
		_r = Search(a[0].$length, (function(a, x) { return function(i) {
			var $ptr, i;
			return ((i < 0 || i >= a[0].$length) ? $throwRuntimeError("index out of range") : a[0].$array[a[0].$offset + i]) >= x[0];
		}; })(a, x)); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: SearchStrings }; } $f.$ptr = $ptr; $f._r = _r; $f.a = a; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.SearchStrings = SearchStrings;
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["github.com/ninchat/ninchat-go"] = (function() {
	var $pkg = {}, $init, errors, js, sort, Action, Event, Frame, backoff, Caller, httpHeader, httpRequest, httpResponse, Session, transport, duration, timer, webSocket, sliceType, sliceType$1, mapType, sliceType$2, ptrType, sliceType$3, ptrType$1, ptrType$2, sliceType$4, ptrType$3, funcType, ptrType$4, ptrType$5, structType, ptrType$6, sliceType$5, ptrType$7, ptrType$8, sliceType$6, funcType$1, funcType$2, ptrType$9, ptrType$10, ptrType$11, funcType$3, funcType$4, chanType, defaultCaller, xhrType, xhrRequestHeaderSupport, sessionEventAckWindow, webSocketSupported, getAddress, getEndpointHosts, singleFrame, Call, emptyData, dataLength, stringData, StringifyFrame, jsError, newJSONRequest, getJSONRequestResponseChannel, getResponseChannel, init, newGETRequest, newDataRequest, getResponseData, putResponseToChannel, jitterFloat64, jitterDuration, jitterInt64, jsonMarshal, jsonUnmarshalArray, jsonUnmarshalObject, jsonParse, longPollBinaryPayload, longPollTransport, longPollTransfer, longPollPing, longPollClose, logErrorResponse, randFloat64, newTimer, init$1, newWebSocket, webSocketTransport, webSocketHandshake, webSocketSend, webSocketReceive;
	errors = $packages["errors"];
	js = $packages["github.com/gopherjs/gopherjs/js"];
	sort = $packages["sort"];
	Action = $pkg.Action = $newType(0, $kindStruct, "ninchat.Action", "Action", "github.com/ninchat/ninchat-go", function(Params_, Payload_, OnReply_, id_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Params = false;
			this.Payload = sliceType$2.nil;
			this.OnReply = $throwNilPointerError;
			this.id = new $Int64(0, 0);
			return;
		}
		this.Params = Params_;
		this.Payload = Payload_;
		this.OnReply = OnReply_;
		this.id = id_;
	});
	Event = $pkg.Event = $newType(0, $kindStruct, "ninchat.Event", "Event", "github.com/ninchat/ninchat-go", function(Params_, Payload_, LastReply_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Params = false;
			this.Payload = sliceType$2.nil;
			this.LastReply = false;
			return;
		}
		this.Params = Params_;
		this.Payload = Payload_;
		this.LastReply = LastReply_;
	});
	Frame = $pkg.Frame = $newType(4, $kindPtr, "ninchat.Frame", "Frame", "github.com/ninchat/ninchat-go", null);
	backoff = $pkg.backoff = $newType(0, $kindStruct, "ninchat.backoff", "backoff", "github.com/ninchat/ninchat-go", function(lastSlot_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.lastSlot = 0;
			return;
		}
		this.lastSlot = lastSlot_;
	});
	Caller = $pkg.Caller = $newType(0, $kindStruct, "ninchat.Caller", "Caller", "github.com/ninchat/ninchat-go", function(Address_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Address = "";
			return;
		}
		this.Address = Address_;
	});
	httpHeader = $pkg.httpHeader = $newType(4, $kindMap, "ninchat.httpHeader", "httpHeader", "github.com/ninchat/ninchat-go", null);
	httpRequest = $pkg.httpRequest = $newType(0, $kindStruct, "ninchat.httpRequest", "httpRequest", "github.com/ninchat/ninchat-go", function(Method_, URL_, Header_, data_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Method = "";
			this.URL = "";
			this.Header = false;
			this.data = null;
			return;
		}
		this.Method = Method_;
		this.URL = URL_;
		this.Header = Header_;
		this.data = data_;
	});
	httpResponse = $pkg.httpResponse = $newType(0, $kindStruct, "ninchat.httpResponse", "httpResponse", "github.com/ninchat/ninchat-go", function(data_, err_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.data = null;
			this.err = $ifaceNil;
			return;
		}
		this.data = data_;
		this.err = err_;
	});
	Session = $pkg.Session = $newType(0, $kindStruct, "ninchat.Session", "Session", "github.com/ninchat/ninchat-go", function(OnSessionEvent_, OnEvent_, OnClose_, OnConnState_, OnConnActive_, OnLog_, Address_, forceLongPoll_, sessionParams_, sessionId_, latestConnState_, lastActionId_, sendNotify_, sendBuffer_, numSent_, sendEventAck_, receivedEventId_, ackedEventId_, closeNotify_, closed_, running_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.OnSessionEvent = $throwNilPointerError;
			this.OnEvent = $throwNilPointerError;
			this.OnClose = $throwNilPointerError;
			this.OnConnState = $throwNilPointerError;
			this.OnConnActive = $throwNilPointerError;
			this.OnLog = $throwNilPointerError;
			this.Address = "";
			this.forceLongPoll = false;
			this.sessionParams = false;
			this.sessionId = $ifaceNil;
			this.latestConnState = "";
			this.lastActionId = new $Int64(0, 0);
			this.sendNotify = $chanNil;
			this.sendBuffer = sliceType$5.nil;
			this.numSent = 0;
			this.sendEventAck = false;
			this.receivedEventId = new $Int64(0, 0);
			this.ackedEventId = new $Int64(0, 0);
			this.closeNotify = $chanNil;
			this.closed = false;
			this.running = false;
			return;
		}
		this.OnSessionEvent = OnSessionEvent_;
		this.OnEvent = OnEvent_;
		this.OnClose = OnClose_;
		this.OnConnState = OnConnState_;
		this.OnConnActive = OnConnActive_;
		this.OnLog = OnLog_;
		this.Address = Address_;
		this.forceLongPoll = forceLongPoll_;
		this.sessionParams = sessionParams_;
		this.sessionId = sessionId_;
		this.latestConnState = latestConnState_;
		this.lastActionId = lastActionId_;
		this.sendNotify = sendNotify_;
		this.sendBuffer = sendBuffer_;
		this.numSent = numSent_;
		this.sendEventAck = sendEventAck_;
		this.receivedEventId = receivedEventId_;
		this.ackedEventId = ackedEventId_;
		this.closeNotify = closeNotify_;
		this.closed = closed_;
		this.running = running_;
	});
	transport = $pkg.transport = $newType(4, $kindFunc, "ninchat.transport", "transport", "github.com/ninchat/ninchat-go", null);
	duration = $pkg.duration = $newType(8, $kindInt64, "ninchat.duration", "duration", "github.com/ninchat/ninchat-go", null);
	timer = $pkg.timer = $newType(0, $kindStruct, "ninchat.timer", "timer", "github.com/ninchat/ninchat-go", function(C_, id_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.C = $chanNil;
			this.id = null;
			return;
		}
		this.C = C_;
		this.id = id_;
	});
	webSocket = $pkg.webSocket = $newType(0, $kindStruct, "ninchat.webSocket", "webSocket", "github.com/ninchat/ninchat-go", function(notify_, goingAway_, err_, impl_, open_, buf_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.notify = $chanNil;
			this.goingAway = false;
			this.err = $ifaceNil;
			this.impl = null;
			this.open = false;
			this.buf = sliceType$6.nil;
			return;
		}
		this.notify = notify_;
		this.goingAway = goingAway_;
		this.err = err_;
		this.impl = impl_;
		this.open = open_;
		this.buf = buf_;
	});
	sliceType = $sliceType($String);
	sliceType$1 = $sliceType($emptyInterface);
	mapType = $mapType($String, $emptyInterface);
	sliceType$2 = $sliceType(Frame);
	ptrType = $ptrType(Event);
	sliceType$3 = $sliceType(ptrType);
	ptrType$1 = $ptrType(sliceType$1);
	ptrType$2 = $ptrType(mapType);
	sliceType$4 = $sliceType($Uint8);
	ptrType$3 = $ptrType(httpRequest);
	funcType = $funcType([], [], false);
	ptrType$4 = $ptrType(js.Object);
	ptrType$5 = $ptrType($Bool);
	structType = $structType([]);
	ptrType$6 = $ptrType(Action);
	sliceType$5 = $sliceType(ptrType$6);
	ptrType$7 = $ptrType(timer);
	ptrType$8 = $ptrType(webSocket);
	sliceType$6 = $sliceType(ptrType$4);
	funcType$1 = $funcType([ptrType$4], [], false);
	funcType$2 = $funcType([ptrType], [], false);
	ptrType$9 = $ptrType(backoff);
	ptrType$10 = $ptrType(Caller);
	ptrType$11 = $ptrType(Session);
	funcType$3 = $funcType([$String], [], false);
	funcType$4 = $funcType([sliceType$1], [], true);
	chanType = $chanType(structType, false, false);
	getAddress = function(address) {
		var $ptr, address;
		if (address === "") {
			return "api.ninchat.com";
		} else {
			return address;
		}
	};
	getEndpointHosts = function(object) {
		var $ptr, _entry, _i, _ref, _tuple, _tuple$1, err, hosts, object, ok, ok$1, s, x, x$1, xHosts;
		hosts = sliceType.nil;
		err = $ifaceNil;
		x = (_entry = object[$String.keyFor("hosts")], _entry !== undefined ? _entry.v : $ifaceNil);
		if ($interfaceIsEqual(x, $ifaceNil)) {
			err = errors.New("invalid endpoint document");
			return [hosts, err];
		}
		_tuple = $assertType(x, sliceType$1, true);
		xHosts = _tuple[0];
		ok = _tuple[1];
		if (!ok) {
			err = errors.New("invalid endpoint hosts type");
			return [hosts, err];
		}
		if (xHosts.$length === 0) {
			err = errors.New("no endpoint hosts");
			return [hosts, err];
		}
		_ref = xHosts;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			x$1 = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			_tuple$1 = $assertType(x$1, $String, true);
			s = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				hosts = $append(hosts, s);
			} else {
				err = errors.New("invalid endpoint host value type");
			}
			_i++;
		}
		if (hosts.$length > 0) {
			err = $ifaceNil;
		}
		return [hosts, err];
	};
	Action.ptr.prototype.String = function() {
		var $ptr, _entry, _tuple, _tuple$1, a, ok, s, x;
		s = "";
		a = this;
		_tuple = (_entry = a.Params[$String.keyFor("action")], _entry !== undefined ? [_entry.v, true] : [$ifaceNil, false]);
		x = _tuple[0];
		ok = _tuple[1];
		if (ok) {
			_tuple$1 = $assertType(x, $String, true);
			s = _tuple$1[0];
		}
		return s;
	};
	Action.prototype.String = function() { return this.$val.String(); };
	Event.ptr.prototype.Bool = function(param) {
		var $ptr, _entry, _tuple, e, param, v, x;
		v = false;
		e = this;
		x = (_entry = e.Params[$String.keyFor(param)], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, $Bool, true);
			v = _tuple[0];
		}
		return v;
	};
	Event.prototype.Bool = function(param) { return this.$val.Bool(param); };
	Event.ptr.prototype.Int = function(param) {
		var $ptr, _entry, _tuple, e, f, ok, param, v, x;
		v = 0;
		ok = false;
		e = this;
		x = (_entry = e.Params[$String.keyFor(param)], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			f = 0;
			_tuple = $assertType(x, $Float64, true);
			f = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				v = (f >> 0);
			}
		}
		return [v, ok];
	};
	Event.prototype.Int = function(param) { return this.$val.Int(param); };
	Event.ptr.prototype.Int64 = function(param) {
		var $ptr, _entry, _tuple, e, f, ok, param, v, x;
		v = new $Int64(0, 0);
		ok = false;
		e = this;
		x = (_entry = e.Params[$String.keyFor(param)], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			f = 0;
			_tuple = $assertType(x, $Float64, true);
			f = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				v = new $Int64(0, f);
			}
		}
		return [v, ok];
	};
	Event.prototype.Int64 = function(param) { return this.$val.Int64(param); };
	Event.ptr.prototype.Float64 = function(param) {
		var $ptr, _entry, _tuple, e, ok, param, v, x;
		v = 0;
		ok = false;
		e = this;
		x = (_entry = e.Params[$String.keyFor(param)], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, $Float64, true);
			v = _tuple[0];
			ok = _tuple[1];
		}
		return [v, ok];
	};
	Event.prototype.Float64 = function(param) { return this.$val.Float64(param); };
	Event.ptr.prototype.Str = function(param) {
		var $ptr, _entry, _tuple, e, ok, param, v, x;
		v = "";
		ok = false;
		e = this;
		x = (_entry = e.Params[$String.keyFor(param)], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, $String, true);
			v = _tuple[0];
			ok = _tuple[1];
		}
		return [v, ok];
	};
	Event.prototype.Str = function(param) { return this.$val.Str(param); };
	Event.ptr.prototype.Array = function(param) {
		var $ptr, _entry, _tuple, e, ok, param, v, x;
		v = sliceType$1.nil;
		ok = false;
		e = this;
		x = (_entry = e.Params[$String.keyFor(param)], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, sliceType$1, true);
			v = _tuple[0];
			ok = _tuple[1];
		}
		return [v, ok];
	};
	Event.prototype.Array = function(param) { return this.$val.Array(param); };
	Event.ptr.prototype.Map = function(param) {
		var $ptr, _entry, _tuple, e, ok, param, v, x;
		v = false;
		ok = false;
		e = this;
		x = (_entry = e.Params[$String.keyFor(param)], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, mapType, true);
			v = _tuple[0];
			ok = _tuple[1];
		}
		return [v, ok];
	};
	Event.prototype.Map = function(param) { return this.$val.Map(param); };
	Event.ptr.prototype.String = function() {
		var $ptr, _tuple, e, s;
		s = "";
		e = this;
		_tuple = e.Str("event");
		s = _tuple[0];
		return s;
	};
	Event.prototype.String = function() { return this.$val.String(); };
	Event.ptr.prototype.initLastReply = function(action) {
		var $ptr, _entry, _entry$1, _tuple, action, e, n;
		e = this;
		_tuple = e.Int("history_length");
		n = _tuple[0];
		if (n > 0) {
			return;
		}
		if (action.String() === "search") {
			if (!($interfaceIsEqual((_entry = e.Params[$String.keyFor("users")], _entry !== undefined ? _entry.v : $ifaceNil), $ifaceNil)) || !($interfaceIsEqual((_entry$1 = e.Params[$String.keyFor("channels")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil), $ifaceNil))) {
				return;
			}
		}
		e.LastReply = true;
	};
	Event.prototype.initLastReply = function(action) { return this.$val.initLastReply(action); };
	Event.ptr.prototype.getError = function() {
		var $ptr, _1, _entry, _entry$1, _entry$2, _tuple, err, errorReason, errorType, event, found, sessionLost, x, x$1;
		errorType = "";
		errorReason = "";
		sessionLost = false;
		err = $ifaceNil;
		event = this;
		_tuple = (_entry = event.Params[$String.keyFor("event")], _entry !== undefined ? [_entry.v, true] : [$ifaceNil, false]);
		x = _tuple[0];
		found = _tuple[1];
		if (!found || !($assertType(x, $String) === "error")) {
			return [errorType, errorReason, sessionLost, err];
		}
		errorType = $assertType((_entry$1 = event.Params[$String.keyFor("error_type")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil), $String);
		x$1 = (_entry$2 = event.Params[$String.keyFor("error_reason")], _entry$2 !== undefined ? _entry$2.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			errorReason = $assertType(x$1, $String);
		}
		_1 = errorType;
		if (_1 === "session_not_found") {
			sessionLost = true;
			if (!(errorReason === "")) {
				err = errors.New("error: " + errorType + " (" + errorReason + ")");
			} else {
				err = errors.New("error: " + errorType);
			}
		} else if (_1 === "connection_superseded" || _1 === "message_has_too_many_parts" || _1 === "message_part_too_long" || _1 === "message_too_long" || _1 === "request_malformed") {
			if (!(errorReason === "")) {
				err = errors.New("error: " + errorType + " (" + errorReason + ")");
			} else {
				err = errors.New("error: " + errorType);
			}
		}
		return [errorType, errorReason, sessionLost, err];
	};
	Event.prototype.getError = function() { return this.$val.getError(); };
	singleFrame = function(x) {
		var $ptr, x;
		return new sliceType$2([x]);
	};
	backoff.ptr.prototype.success = function() {
		var $ptr, b;
		b = this;
		b.lastSlot = 0;
	};
	backoff.prototype.success = function() { return this.$val.success(); };
	backoff.ptr.prototype.failure = function(maxDelay) {
		var $ptr, b, delay, maxDelay;
		delay = new duration(0, 0);
		b = this;
		if (b.lastSlot > 0) {
			delay = new duration(0, jitterFloat64($flatten64(maxDelay) * b.lastSlot / 1024, -0.5));
		}
		if (b.lastSlot < 1023) {
			b.lastSlot = ((((b.lastSlot + 1 >> 0)) << 1 >> 0)) - 1 >> 0;
		}
		return delay;
	};
	backoff.prototype.failure = function(maxDelay) { return this.$val.failure(maxDelay); };
	Call = function(action) {
		var $ptr, _r, _tuple, action, err, events, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tuple = $f._tuple; action = $f.action; err = $f.err; events = $f.events; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		events = sliceType$3.nil;
		err = $ifaceNil;
		_r = defaultCaller.Call(action); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		events = _tuple[0];
		err = _tuple[1];
		/* */ $s = 2; case 2:
		return [events, err];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Call }; } $f.$ptr = $ptr; $f._r = _r; $f._tuple = _tuple; $f.action = action; $f.err = err; $f.events = events; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.Call = Call;
	Caller.ptr.prototype.Call = function(action) {
		var $ptr, _i, _r, _ref, _tuple, _tuple$1, _tuple$2, action, caller, data, err, event, events, headers, i, ok, params, params$1, req, timeout, url, xParams, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _i = $f._i; _r = $f._r; _ref = $f._ref; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; _tuple$2 = $f._tuple$2; action = $f.action; caller = $f.caller; data = $f.data; err = $f.err; event = $f.event; events = $f.events; headers = $f.headers; i = $f.i; ok = $f.ok; params = $f.params; params$1 = $f.params$1; req = $f.req; timeout = $f.timeout; url = $f.url; xParams = $f.xParams; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		headers = [headers];
		params = [params];
		events = sliceType$3.nil;
		err = $ifaceNil;
		caller = this;
		url = "https://" + getAddress(caller.Address) + "/v2/call";
		_tuple = newJSONRequest(url, action.Params);
		req = _tuple[0];
		err = _tuple[1];
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			return [events, err];
		}
		new httpHeader(req.Header).Set("Accept", "application/json");
		new httpHeader(req.Header).Set("Content-Type", "application/json");
		timeout = jitterDuration(new duration(0, 11000), 0.1);
		_r = getResponseData(req, timeout); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple$1 = _r;
		data = _tuple$1[0];
		err = _tuple$1[1];
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			return [events, err];
		}
		headers[0] = sliceType$1.nil;
		if (!($interfaceIsEqual(jsonUnmarshalArray(data, (headers.$ptr || (headers.$ptr = new ptrType$1(function() { return this.$target[0]; }, function($v) { this.$target[0] = $v; }, headers)))), $ifaceNil))) {
			params[0] = false;
			err = jsonUnmarshalObject(data, (params.$ptr || (params.$ptr = new ptrType$2(function() { return this.$target[0]; }, function($v) { this.$target[0] = $v; }, params))));
			if (!($interfaceIsEqual(err, $ifaceNil))) {
				return [events, err];
			}
			headers[0] = new sliceType$1([new mapType(params[0])]);
		}
		events = $makeSlice(sliceType$3, 0, headers[0].$length);
		_ref = headers[0];
		_i = 0;
		/* while (true) { */ case 2:
			/* if (!(_i < _ref.$length)) { break; } */ if(!(_i < _ref.$length)) { $s = 3; continue; }
			i = _i;
			xParams = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			_tuple$2 = $assertType(xParams, mapType, true);
			params$1 = _tuple$2[0];
			ok = _tuple$2[1];
			if (!ok) {
				err = errors.New("response event header is not an object");
				return [events, err];
			}
			event = new Event.ptr(params$1, sliceType$2.nil, i === (headers[0].$length - 1 >> 0));
			/* */ if (!(action.OnReply === $throwNilPointerError)) { $s = 4; continue; }
			/* */ $s = 5; continue;
			/* if (!(action.OnReply === $throwNilPointerError)) { */ case 4:
				$r = action.OnReply(event); /* */ $s = 6; case 6: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* } */ case 5:
			events = $append(events, event);
			_i++;
		/* } */ $s = 2; continue; case 3:
		return [events, err];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Caller.ptr.prototype.Call }; } $f.$ptr = $ptr; $f._i = _i; $f._r = _r; $f._ref = _ref; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f._tuple$2 = _tuple$2; $f.action = action; $f.caller = caller; $f.data = data; $f.err = err; $f.event = event; $f.events = events; $f.headers = headers; $f.i = i; $f.ok = ok; $f.params = params; $f.params$1 = params$1; $f.req = req; $f.timeout = timeout; $f.url = url; $f.xParams = xParams; $f.$s = $s; $f.$r = $r; return $f;
	};
	Caller.prototype.Call = function(action) { return this.$val.Call(action); };
	emptyData = function() {
		var $ptr;
		return new ($global.String)();
	};
	dataLength = function(x) {
		var $ptr, x;
		return $parseInt(x.length);
	};
	stringData = function(x) {
		var $ptr, x;
		return StringifyFrame(x);
	};
	StringifyFrame = function(object) {
		var $ptr, _tuple, goBytes, goString, jsView, object, ok;
		_tuple = $assertType($internalize(object, $emptyInterface), $String, true);
		ok = _tuple[1];
		if (ok) {
			return object;
		}
		jsView = new ($global.Uint8Array)(object);
		goBytes = $assertType($internalize(jsView, $emptyInterface), sliceType$4);
		goString = $bytesToString(goBytes);
		return new ($global.String)($externalize(goString, $String));
	};
	$pkg.StringifyFrame = StringifyFrame;
	jsError = function(x) {
		var $ptr, _ref, err, t, t$1, t$2, x;
		err = $ifaceNil;
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_ref = x;
			if ($assertType(_ref, $error, true)[1]) {
				t = _ref;
				err = t;
			} else if ($assertType(_ref, $String, true)[1]) {
				t$1 = _ref.$val;
				err = errors.New(t$1);
			} else {
				t$2 = _ref;
				err = errors.New("?");
			}
		}
		return err;
	};
	newJSONRequest = function(url, action) {
		var $ptr, _tuple, _tuple$1, action, data, err, req, url;
		req = ptrType$3.nil;
		err = $ifaceNil;
		_tuple = jsonMarshal(action);
		data = _tuple[0];
		err = _tuple[1];
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			return [req, err];
		}
		_tuple$1 = newDataRequest("POST", url, data);
		req = _tuple$1[0];
		err = _tuple$1[1];
		return [req, err];
	};
	getJSONRequestResponseChannel = function(url, action, timeout) {
		var $ptr, _tuple, action, c, err, req, timeout, url, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _tuple = $f._tuple; action = $f.action; c = $f.c; err = $f.err; req = $f.req; timeout = $f.timeout; url = $f.url; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		c = new $Chan(httpResponse, 1);
		_tuple = newJSONRequest(url, action);
		req = _tuple[0];
		err = _tuple[1];
		/* */ if ($interfaceIsEqual(err, $ifaceNil)) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if ($interfaceIsEqual(err, $ifaceNil)) { */ case 1:
			$r = putResponseToChannel(req, timeout, c); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			$s = 3; continue;
		/* } else { */ case 2:
			$r = $send(c, new httpResponse.ptr(null, err)); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 3:
		return c;
		/* */ } return; } if ($f === undefined) { $f = { $blk: getJSONRequestResponseChannel }; } $f.$ptr = $ptr; $f._tuple = _tuple; $f.action = action; $f.c = c; $f.err = err; $f.req = req; $f.timeout = timeout; $f.url = url; $f.$s = $s; $f.$r = $r; return $f;
	};
	getResponseChannel = function(req, timeout) {
		var $ptr, c, req, timeout, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; c = $f.c; req = $f.req; timeout = $f.timeout; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		c = new $Chan(httpResponse, 1);
		$r = putResponseToChannel(req, timeout, c); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		return c;
		/* */ } return; } if ($f === undefined) { $f = { $blk: getResponseChannel }; } $f.$ptr = $ptr; $f.c = c; $f.req = req; $f.timeout = timeout; $f.$s = $s; $f.$r = $r; return $f;
	};
	init = function() {
		var $ptr;
		xhrType = $global.XDomainRequest;
		if (xhrType === undefined) {
			xhrType = $global.XMLHttpRequest;
			xhrRequestHeaderSupport = true;
		}
	};
	httpHeader.prototype.Set = function(key, value) {
		var $ptr, _key, h, key, value;
		h = this.$val;
		_key = key; (h || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key)] = { k: _key, v: value };
	};
	$ptrType(httpHeader).prototype.Set = function(key, value) { return new httpHeader(this.$get()).Set(key, value); };
	newGETRequest = function(url) {
		var $ptr, err, req, url;
		req = ptrType$3.nil;
		err = $ifaceNil;
		req = new httpRequest.ptr("GET", url, {}, null);
		return [req, err];
	};
	newDataRequest = function(method, url, data) {
		var $ptr, data, err, method, req, url;
		req = ptrType$3.nil;
		err = $ifaceNil;
		req = new httpRequest.ptr(method, url, {}, data);
		return [req, err];
	};
	getResponseData = function(req, timeout) {
		var $ptr, _r, _r$1, req, resp, timeout, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; req = $f.req; resp = $f.resp; timeout = $f.timeout; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = getResponseChannel(req, timeout); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_r$1 = $recv(_r); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		resp = $clone(_r$1[0], httpResponse);
		return [resp.data, resp.err];
		/* */ } return; } if ($f === undefined) { $f = { $blk: getResponseData }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f.req = req; $f.resp = resp; $f.timeout = timeout; $f.$s = $s; $f.$r = $r; return $f;
	};
	putResponseToChannel = function(req, timeout, c) {
		var $ptr, _entry, _i, _keys, _ref, c, key, req, timeout, value, xhr, $s, $deferred, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _entry = $f._entry; _i = $f._i; _keys = $f._keys; _ref = $f._ref; c = $f.c; key = $f.key; req = $f.req; timeout = $f.timeout; value = $f.value; xhr = $f.xhr; $s = $f.$s; $deferred = $f.$deferred; $r = $f.$r; } var $err = null; try { s: while (true) { switch ($s) { case 0: $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		c = [c];
		req = [req];
		xhr = [xhr];
		$deferred.push([(function(c, req, xhr) { return function $b() {
			var $ptr, err, $s, $r;
			/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; err = $f.err; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
			err = jsError($recover());
			/* */ if (!($interfaceIsEqual(err, $ifaceNil))) { $s = 1; continue; }
			/* */ $s = 2; continue;
			/* if (!($interfaceIsEqual(err, $ifaceNil))) { */ case 1:
				$r = $send(c[0], new httpResponse.ptr(null, err)); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* } */ case 2:
			/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f.err = err; $f.$s = $s; $f.$r = $r; return $f;
		}; })(c, req, xhr), []]);
		xhr[0] = new (xhrType)();
		xhr[0].onload = $externalize((function(c, req, xhr) { return function() {
			var $ptr, response;
			response = xhr[0].responseText;
			$go((function(c, req, xhr) { return function $b() {
				var $ptr, $s, $r;
				/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
				$r = $send(c[0], new httpResponse.ptr(response, $ifaceNil)); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f.$s = $s; $f.$r = $r; return $f;
			}; })(c, req, xhr), []);
		}; })(c, req, xhr), funcType);
		xhr[0].onprogress = $externalize((function(c, req, xhr) { return function() {
			var $ptr;
			$global.setTimeout($externalize((function(c, req, xhr) { return function() {
				var $ptr;
			}; })(c, req, xhr), funcType), 0);
		}; })(c, req, xhr), funcType);
		xhr[0].ontimeout = $externalize((function(c, req, xhr) { return function() {
			var $ptr;
			$go((function(c, req, xhr) { return function $b() {
				var $ptr, $s, $r;
				/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
				$r = $send(c[0], new httpResponse.ptr(null, errors.New("timeout"))); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f.$s = $s; $f.$r = $r; return $f;
			}; })(c, req, xhr), []);
		}; })(c, req, xhr), funcType);
		xhr[0].onerror = $externalize((function(c, req, xhr) { return function() {
			var $ptr;
			$go((function(c, req, xhr) { return function $b() {
				var $ptr, $s, $r;
				/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
				$r = $send(c[0], new httpResponse.ptr(null, errors.New("error"))); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f.$s = $s; $f.$r = $r; return $f;
			}; })(c, req, xhr), []);
		}; })(c, req, xhr), funcType);
		xhr[0].open($externalize(req[0].Method, $String), $externalize(req[0].URL, $String));
		xhr[0].timeout = $externalize(timeout, duration);
		if (xhrRequestHeaderSupport) {
			_ref = req[0].Header;
			_i = 0;
			_keys = $keys(_ref);
			while (true) {
				if (!(_i < _keys.length)) { break; }
				_entry = _ref[_keys[_i]];
				if (_entry === undefined) {
					_i++;
					continue;
				}
				key = _entry.k;
				value = _entry.v;
				xhr[0].setRequestHeader($externalize(key, $String), $externalize(value, $String));
				_i++;
			}
		}
		$global.setTimeout($externalize((function(c, req, xhr) { return function() {
			var $ptr;
			xhr[0].send(req[0].data);
		}; })(c, req, xhr), funcType), 0);
		/* */ $s = -1; case -1: } return; } } catch(err) { $err = err; $s = -1; } finally { $callDeferred($deferred, $err); if($curGoroutine.asleep) { if ($f === undefined) { $f = { $blk: putResponseToChannel }; } $f.$ptr = $ptr; $f._entry = _entry; $f._i = _i; $f._keys = _keys; $f._ref = _ref; $f.c = c; $f.key = key; $f.req = req; $f.timeout = timeout; $f.value = value; $f.xhr = xhr; $f.$s = $s; $f.$deferred = $deferred; $f.$r = $r; return $f; } }
	};
	jitterFloat64 = function(x, scale) {
		var $ptr, scale, x;
		return x + x * scale * randFloat64();
	};
	jitterDuration = function(d, scale) {
		var $ptr, d, scale;
		return new duration(0, jitterFloat64($flatten64(d), scale));
	};
	jitterInt64 = function(n, scale) {
		var $ptr, n, scale;
		return new $Int64(0, jitterFloat64($flatten64(n), scale));
	};
	jsonMarshal = function(v) {
		var $ptr, data, err, v, $deferred;
		/* */ var $err = null; try { $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		data = null;
		err = $ifaceNil;
		$deferred.push([(function() {
			var $ptr;
			err = jsError($recover());
		}), []]);
		data = $global.JSON.stringify($externalize(v, mapType));
		return [data, err];
		/* */ } catch(err) { $err = err; } finally { $callDeferred($deferred, $err); if (!$curGoroutine.asleep) { return  [data, err]; } }
	};
	jsonUnmarshalArray = function(data, v) {
		var $ptr, _tuple, _tuple$1, data, err, object, ok, v, x;
		err = $ifaceNil;
		_tuple = jsonParse(data);
		object = _tuple[0];
		err = _tuple[1];
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			return err;
		}
		_tuple$1 = $assertType(object, sliceType$1, true);
		x = _tuple$1[0];
		ok = _tuple$1[1];
		if (!ok) {
			err = errors.New("json: cannot unmarshal value into Go value of type *[]interface{}");
			return err;
		}
		v.$set(x);
		return err;
	};
	jsonUnmarshalObject = function(data, v) {
		var $ptr, _tuple, _tuple$1, data, err, object, ok, v, x;
		err = $ifaceNil;
		_tuple = jsonParse(data);
		object = _tuple[0];
		err = _tuple[1];
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			return err;
		}
		_tuple$1 = $assertType(object, mapType, true);
		x = _tuple$1[0];
		ok = _tuple$1[1];
		if (!ok) {
			err = errors.New("json: cannot unmarshal value into Go value of type *map[string]interface{}");
			return err;
		}
		v.$set(x);
		return err;
	};
	jsonParse = function(data) {
		var $ptr, data, err, x, $deferred;
		/* */ var $err = null; try { $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		x = $ifaceNil;
		err = $ifaceNil;
		$deferred.push([(function() {
			var $ptr;
			err = jsError($recover());
		}), []]);
		x = $internalize($global.JSON.parse(data), $emptyInterface);
		return [x, err];
		/* */ } catch(err) { $err = err; } finally { $callDeferred($deferred, $err); if (!$curGoroutine.asleep) { return  [x, err]; } }
	};
	longPollBinaryPayload = function(action) {
		var $ptr, _i, _ref, action, base64, dataURI, payload;
		payload = sliceType$1.nil;
		_ref = action.Payload;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			dataURI = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			base64 = $pointerOfStructConversion(dataURI, ptrType$4).split($externalize(",", $String))[1];
			payload = $append(payload, new $jsObjectPtr(base64));
			_i++;
		}
		return payload;
	};
	longPollTransport = function(s, host) {
		var $ptr, _r, _r$1, _r$2, _selection, _tuple, action, array, connWorked, err, event, gotOnline, host, ok, response, s, timeout, url, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _selection = $f._selection; _tuple = $f._tuple; action = $f.action; array = $f.array; connWorked = $f.connWorked; err = $f.err; event = $f.event; gotOnline = $f.gotOnline; host = $f.host; ok = $f.ok; response = $f.response; s = $f.s; timeout = $f.timeout; url = $f.url; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		array = [array];
		connWorked = [connWorked];
		gotOnline = [gotOnline];
		connWorked[0] = false;
		gotOnline[0] = false;
		url = "https://" + host + "/v2/poll";
		/* */ if ($interfaceIsEqual(s.sessionId, $ifaceNil)) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if ($interfaceIsEqual(s.sessionId, $ifaceNil)) { */ case 1:
			$r = s.log(new sliceType$1([new $String("session creation")])); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			action = s.makeCreateSessionAction();
			timeout = jitterDuration(new duration(0, 13000), 0.2);
			_r = getJSONRequestResponseChannel(url, action, timeout); /* */ $s = 5; case 5: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			_r$1 = $select([[_r], [s.closeNotify]]); /* */ $s = 6; case 6: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			_selection = _r$1;
			/* */ if (_selection[0] === 0) { $s = 7; continue; }
			/* */ if (_selection[0] === 1) { $s = 8; continue; }
			/* */ $s = 9; continue;
			/* if (_selection[0] === 0) { */ case 7:
				response = $clone(_selection[1][0], httpResponse);
				/* */ if (!($interfaceIsEqual(response.err, $ifaceNil))) { $s = 10; continue; }
				/* */ $s = 11; continue;
				/* if (!($interfaceIsEqual(response.err, $ifaceNil))) { */ case 10:
					$r = s.log(new sliceType$1([new $String("session creation:"), response.err])); /* */ $s = 12; case 12: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					return [connWorked[0], gotOnline[0]];
				/* } */ case 11:
				array[0] = sliceType$1.nil;
				err = jsonUnmarshalArray(response.data, (array.$ptr || (array.$ptr = new ptrType$1(function() { return this.$target[0]; }, function($v) { this.$target[0] = $v; }, array))));
				/* */ if (!($interfaceIsEqual(err, $ifaceNil))) { $s = 13; continue; }
				/* */ $s = 14; continue;
				/* if (!($interfaceIsEqual(err, $ifaceNil))) { */ case 13:
					$r = s.log(new sliceType$1([new $String("session creation response:"), err])); /* */ $s = 15; case 15: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					return [connWorked[0], gotOnline[0]];
				/* } */ case 14:
				/* */ if (array[0].$length === 0) { $s = 16; continue; }
				/* */ $s = 17; continue;
				/* if (array[0].$length === 0) { */ case 16:
					$r = s.log(new sliceType$1([new $String("session creation response JSON array is empty")])); /* */ $s = 18; case 18: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					return [connWorked[0], gotOnline[0]];
				/* } */ case 17:
				_tuple = $assertType((0 >= array[0].$length ? $throwRuntimeError("index out of range") : array[0].$array[array[0].$offset + 0]), mapType, true);
				event = _tuple[0];
				ok = _tuple[1];
				/* */ if (!ok) { $s = 19; continue; }
				/* */ $s = 20; continue;
				/* if (!ok) { */ case 19:
					$r = s.log(new sliceType$1([new $String("session creation response header is not a JSON object")])); /* */ $s = 21; case 21: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					return [connWorked[0], gotOnline[0]];
				/* } */ case 20:
				_r$2 = s.handleSessionEvent(event); /* */ $s = 24; case 24: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
				/* */ if (!_r$2) { $s = 22; continue; }
				/* */ $s = 23; continue;
				/* if (!_r$2) { */ case 22:
					return [connWorked[0], gotOnline[0]];
				/* } */ case 23:
				$s = 9; continue;
			/* } else if (_selection[0] === 1) { */ case 8:
				$r = longPollClose(s, url); /* */ $s = 25; case 25: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				return [connWorked[0], gotOnline[0]];
			/* } */ case 9:
			connWorked[0] = true;
			gotOnline[0] = true;
			$r = s.connState("connected"); /* */ $s = 26; case 26: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			$r = s.connActive(); /* */ $s = 27; case 27: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			$s = 3; continue;
		/* } else { */ case 2:
			$r = s.log(new sliceType$1([new $String("session resumption")])); /* */ $s = 28; case 28: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			$r = longPollPing(s, url); /* */ $s = 29; case 29: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 3:
		$r = longPollTransfer(s, url, (connWorked.$ptr || (connWorked.$ptr = new ptrType$5(function() { return this.$target[0]; }, function($v) { this.$target[0] = $v; }, connWorked))), (gotOnline.$ptr || (gotOnline.$ptr = new ptrType$5(function() { return this.$target[0]; }, function($v) { this.$target[0] = $v; }, gotOnline)))); /* */ $s = 30; case 30: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		return [connWorked[0], gotOnline[0]];
		/* */ } return; } if ($f === undefined) { $f = { $blk: longPollTransport }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._selection = _selection; $f._tuple = _tuple; $f.action = action; $f.array = array; $f.connWorked = connWorked; $f.err = err; $f.event = event; $f.gotOnline = gotOnline; $f.host = host; $f.ok = ok; $f.response = response; $f.s = s; $f.timeout = timeout; $f.url = url; $f.$s = $s; $f.$r = $r; return $f;
	};
	longPollTransfer = function(s, url, connWorked, gotOnline) {
		var $ptr, _entry, _i, _key, _key$1, _key$2, _r, _r$1, _r$2, _r$3, _ref, _selection, _tuple, _tuple$1, _tuple$2, _tuple$3, _tuple$4, ackedActionId, action, action$1, array, channel, connWorked, err, err$1, err$2, event, failures, gotOnline, json, object, object$1, ok, ok$1, params, poller, response, s, sender, sending, sendingId, sessionLost, timeout, timeout$1, url, x, x$1, x$2, x$3, x$4, x$5, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _entry = $f._entry; _i = $f._i; _key = $f._key; _key$1 = $f._key$1; _key$2 = $f._key$2; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _ref = $f._ref; _selection = $f._selection; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; _tuple$2 = $f._tuple$2; _tuple$3 = $f._tuple$3; _tuple$4 = $f._tuple$4; ackedActionId = $f.ackedActionId; action = $f.action; action$1 = $f.action$1; array = $f.array; channel = $f.channel; connWorked = $f.connWorked; err = $f.err; err$1 = $f.err$1; err$2 = $f.err$2; event = $f.event; failures = $f.failures; gotOnline = $f.gotOnline; json = $f.json; object = $f.object; object$1 = $f.object$1; ok = $f.ok; ok$1 = $f.ok$1; params = $f.params; poller = $f.poller; response = $f.response; s = $f.s; sender = $f.sender; sending = $f.sending; sendingId = $f.sendingId; sessionLost = $f.sessionLost; timeout = $f.timeout; timeout$1 = $f.timeout$1; url = $f.url; x = $f.x; x$1 = $f.x$1; x$2 = $f.x$2; x$3 = $f.x$3; x$4 = $f.x$4; x$5 = $f.x$5; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		poller = $chanNil;
		sender = $chanNil;
		sendingId = new $Int64(0, 0);
		failures = 0;
		s.numSent = 0;
		/* while (true) { */ case 1:
			/* if (!(failures < 2)) { break; } */ if(!(failures < 2)) { $s = 2; continue; }
			array = [array];
			object = [object];
			/* */ if (poller === $chanNil) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (poller === $chanNil) { */ case 3:
				action = s.makeResumeSessionAction(true);
				timeout = jitterDuration(new duration(0, 64000), 0.2);
				_r = getJSONRequestResponseChannel(url, action, timeout); /* */ $s = 5; case 5: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				poller = _r;
			/* } */ case 4:
			/* */ if (sender === $chanNil && s.numSent < s.sendBuffer.$length) { $s = 6; continue; }
			/* */ $s = 7; continue;
			/* if (sender === $chanNil && s.numSent < s.sendBuffer.$length) { */ case 6:
				action$1 = (x = s.sendBuffer, x$1 = s.numSent, ((x$1 < 0 || x$1 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + x$1]));
				/* */ if (!(action$1.Payload === sliceType$2.nil)) { $s = 8; continue; }
				/* */ $s = 9; continue;
				/* if (!(action$1.Payload === sliceType$2.nil)) { */ case 8:
					/* */ if (action$1.String() === "update_user") { $s = 10; continue; }
					/* */ $s = 11; continue;
					/* if (action$1.String() === "update_user") { */ case 10:
						_key = "payload"; (action$1.Params || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key)] = { k: _key, v: longPollBinaryPayload(action$1) };
						$s = 12; continue;
					/* } else { */ case 11:
						object[0] = false;
						err = jsonUnmarshalObject((x$2 = action$1.Payload, (0 >= x$2.$length ? $throwRuntimeError("index out of range") : x$2.$array[x$2.$offset + 0])), (object.$ptr || (object.$ptr = new ptrType$2(function() { return this.$target[0]; }, function($v) { this.$target[0] = $v; }, object))));
						/* */ if (!($interfaceIsEqual(err, $ifaceNil))) { $s = 13; continue; }
						/* */ $s = 14; continue;
						/* if (!($interfaceIsEqual(err, $ifaceNil))) { */ case 13:
							$r = s.log(new sliceType$1([new $String("send:"), err])); /* */ $s = 15; case 15: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
							return;
						/* } */ case 14:
						_key$1 = "payload"; (action$1.Params || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key$1)] = { k: _key$1, v: new mapType(object[0]) };
					/* } */ case 12:
				/* } */ case 9:
				_key$2 = "session_id"; (action$1.Params || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key$2)] = { k: _key$2, v: s.sessionId };
				timeout$1 = jitterDuration(new duration(0, 7000), 0.2);
				_r$1 = getJSONRequestResponseChannel(url, action$1.Params, timeout$1); /* */ $s = 16; case 16: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
				channel = _r$1;
				delete action$1.Params[$String.keyFor("session_id")];
				delete action$1.Params[$String.keyFor("payload")];
				if ((x$3 = action$1.id, (x$3.$high === 0 && x$3.$low === 0))) {
					$go(logErrorResponse, [s, channel, "send error:"]);
					s.sendBuffer = $appendSlice($subslice(s.sendBuffer, 0, s.numSent), $subslice(s.sendBuffer, (s.numSent + 1 >> 0)));
				} else {
					sender = channel;
					sendingId = action$1.id;
				}
			/* } */ case 7:
			response = new httpResponse.ptr(null, $ifaceNil);
			_r$2 = $select([[poller], [sender], [s.sendNotify], [s.closeNotify]]); /* */ $s = 17; case 17: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
			_selection = _r$2;
			/* */ if (_selection[0] === 0) { $s = 18; continue; }
			/* */ if (_selection[0] === 1) { $s = 19; continue; }
			/* */ if (_selection[0] === 2) { $s = 20; continue; }
			/* */ if (_selection[0] === 3) { $s = 21; continue; }
			/* */ $s = 22; continue;
			/* if (_selection[0] === 0) { */ case 18:
				httpResponse.copy(response, _selection[1][0]);
				/* */ if (!($interfaceIsEqual(response.err, $ifaceNil))) { $s = 23; continue; }
				/* */ $s = 24; continue;
				/* if (!($interfaceIsEqual(response.err, $ifaceNil))) { */ case 23:
					$r = s.log(new sliceType$1([new $String("poll error:"), response.err])); /* */ $s = 25; case 25: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				/* } */ case 24:
				poller = $chanNil;
				$r = s.connActive(); /* */ $s = 26; case 26: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				$s = 22; continue;
			/* } else if (_selection[0] === 1) { */ case 19:
				httpResponse.copy(response, _selection[1][0]);
				/* */ if (!($interfaceIsEqual(response.err, $ifaceNil))) { $s = 27; continue; }
				/* */ if ((sendingId.$high > 0 || (sendingId.$high === 0 && sendingId.$low > 0))) { $s = 28; continue; }
				/* */ $s = 29; continue;
				/* if (!($interfaceIsEqual(response.err, $ifaceNil))) { */ case 27:
					$r = s.log(new sliceType$1([new $String("send error:"), response.err])); /* */ $s = 30; case 30: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					$s = 29; continue;
				/* } else if ((sendingId.$high > 0 || (sendingId.$high === 0 && sendingId.$low > 0))) { */ case 28:
					s.numSent = s.numSent + (1) >> 0;
				/* } */ case 29:
				sender = $chanNil;
				sendingId = new $Int64(0, 0);
				$s = 22; continue;
			/* } else if (_selection[0] === 2) { */ case 20:
				_tuple = _selection[1];
				sending = _tuple[1];
				/* */ if (!sending) { $s = 31; continue; }
				/* */ $s = 32; continue;
				/* if (!sending) { */ case 31:
					$r = longPollClose(s, url); /* */ $s = 33; case 33: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					return;
				/* } */ case 32:
				/* continue; */ $s = 1; continue;
				$s = 22; continue;
			/* } else if (_selection[0] === 3) { */ case 21:
				$r = longPollClose(s, url); /* */ $s = 34; case 34: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				return;
			/* } */ case 22:
			array[0] = sliceType$1.nil;
			err$1 = response.err;
			/* */ if ($interfaceIsEqual(err$1, $ifaceNil)) { $s = 35; continue; }
			/* */ $s = 36; continue;
			/* if ($interfaceIsEqual(err$1, $ifaceNil)) { */ case 35:
				err$1 = jsonUnmarshalArray(response.data, (array.$ptr || (array.$ptr = new ptrType$1(function() { return this.$target[0]; }, function($v) { this.$target[0] = $v; }, array))));
				/* */ if (!($interfaceIsEqual(err$1, $ifaceNil))) { $s = 37; continue; }
				/* */ $s = 38; continue;
				/* if (!($interfaceIsEqual(err$1, $ifaceNil))) { */ case 37:
					$r = s.log(new sliceType$1([new $String("response:"), err$1])); /* */ $s = 39; case 39: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				/* } */ case 38:
			/* } */ case 36:
			/* */ if (!($interfaceIsEqual(err$1, $ifaceNil))) { $s = 40; continue; }
			/* */ $s = 41; continue;
			/* if (!($interfaceIsEqual(err$1, $ifaceNil))) { */ case 40:
				failures = failures + (1) >> 0;
				s.numSent = 0;
				/* continue; */ $s = 1; continue;
			/* } */ case 41:
			failures = 0;
			connWorked.$set(true);
			_ref = array[0];
			_i = 0;
			/* while (true) { */ case 42:
				/* if (!(_i < _ref.$length)) { break; } */ if(!(_i < _ref.$length)) { $s = 43; continue; }
				x$4 = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
				_tuple$1 = $assertType(x$4, mapType, true);
				params = _tuple$1[0];
				ok = _tuple$1[1];
				/* */ if (!ok) { $s = 44; continue; }
				/* */ $s = 45; continue;
				/* if (!ok) { */ case 44:
					$r = s.log(new sliceType$1([new $String("poll event is not an object")])); /* */ $s = 46; case 46: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					return;
				/* } */ case 45:
				event = new Event.ptr(params, sliceType$2.nil, false);
				x$5 = (_entry = params[$String.keyFor("payload")], _entry !== undefined ? _entry.v : $ifaceNil);
				/* */ if (!($interfaceIsEqual(x$5, $ifaceNil))) { $s = 47; continue; }
				/* */ $s = 48; continue;
				/* if (!($interfaceIsEqual(x$5, $ifaceNil))) { */ case 47:
					_tuple$2 = $assertType(x$5, mapType, true);
					object$1 = _tuple$2[0];
					ok$1 = _tuple$2[1];
					/* */ if (!ok$1) { $s = 49; continue; }
					/* */ $s = 50; continue;
					/* if (!ok$1) { */ case 49:
						$r = s.log(new sliceType$1([new $String("poll payload is not an object")])); /* */ $s = 51; case 51: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
						return;
					/* } */ case 50:
					_tuple$3 = jsonMarshal(object$1);
					json = _tuple$3[0];
					err$2 = _tuple$3[1];
					/* */ if (!($interfaceIsEqual(err$2, $ifaceNil))) { $s = 52; continue; }
					/* */ $s = 53; continue;
					/* if (!($interfaceIsEqual(err$2, $ifaceNil))) { */ case 52:
						$r = s.log(new sliceType$1([new $String("poll payload:"), err$2])); /* */ $s = 54; case 54: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
						return;
					/* } */ case 53:
					event.Payload = singleFrame(json);
				/* } */ case 48:
				_r$3 = s.handleEvent(event); /* */ $s = 55; case 55: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
				_tuple$4 = _r$3;
				ackedActionId = _tuple$4[0];
				sessionLost = _tuple$4[1];
				ok = _tuple$4[3];
				if ((sendingId.$high > 0 || (sendingId.$high === 0 && sendingId.$low > 0)) && (sendingId.$high < ackedActionId.$high || (sendingId.$high === ackedActionId.$high && sendingId.$low <= ackedActionId.$low))) {
					sendingId = new $Int64(0, 0);
					s.numSent = s.numSent + (1) >> 0;
				}
				if (!ok) {
					if (sessionLost) {
						gotOnline.$set(true);
					}
					return;
				}
				/* */ if (!gotOnline.$get()) { $s = 56; continue; }
				/* */ $s = 57; continue;
				/* if (!gotOnline.$get()) { */ case 56:
					gotOnline.$set(true);
					$r = s.connState("connected"); /* */ $s = 58; case 58: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				/* } */ case 57:
				_i++;
			/* } */ $s = 42; continue; case 43:
		/* } */ $s = 1; continue; case 2:
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: longPollTransfer }; } $f.$ptr = $ptr; $f._entry = _entry; $f._i = _i; $f._key = _key; $f._key$1 = _key$1; $f._key$2 = _key$2; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._ref = _ref; $f._selection = _selection; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f._tuple$2 = _tuple$2; $f._tuple$3 = _tuple$3; $f._tuple$4 = _tuple$4; $f.ackedActionId = ackedActionId; $f.action = action; $f.action$1 = action$1; $f.array = array; $f.channel = channel; $f.connWorked = connWorked; $f.err = err; $f.err$1 = err$1; $f.err$2 = err$2; $f.event = event; $f.failures = failures; $f.gotOnline = gotOnline; $f.json = json; $f.object = object; $f.object$1 = object$1; $f.ok = ok; $f.ok$1 = ok$1; $f.params = params; $f.poller = poller; $f.response = response; $f.s = s; $f.sender = sender; $f.sending = sending; $f.sendingId = sendingId; $f.sessionLost = sessionLost; $f.timeout = timeout; $f.timeout$1 = timeout$1; $f.url = url; $f.x = x; $f.x$1 = x$1; $f.x$2 = x$2; $f.x$3 = x$3; $f.x$4 = x$4; $f.x$5 = x$5; $f.$s = $s; $f.$r = $r; return $f;
	};
	longPollPing = function(s, url) {
		var $ptr, _r, action, c, s, url, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; action = $f.action; c = $f.c; s = $f.s; url = $f.url; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		action = $makeMap($String.keyFor, [{ k: "action", v: new $String("ping") }, { k: "session_id", v: s.sessionId }]);
		_r = getJSONRequestResponseChannel(url, action, jitterDuration(new duration(0, 7000), 0.9)); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		c = _r;
		$go(logErrorResponse, [s, c, "ping error:"]);
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: longPollPing }; } $f.$ptr = $ptr; $f._r = _r; $f.action = action; $f.c = c; $f.s = s; $f.url = url; $f.$s = $s; $f.$r = $r; return $f;
	};
	longPollClose = function(s, url) {
		var $ptr, _r, action, c, s, url, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; action = $f.action; c = $f.c; s = $f.s; url = $f.url; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		action = $makeMap($String.keyFor, [{ k: "action", v: new $String("close_session") }, { k: "session_id", v: s.sessionId }]);
		_r = getJSONRequestResponseChannel(url, action, jitterDuration(new duration(0, 7000), 0.9)); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		c = _r;
		$go(logErrorResponse, [s, c, "send error:"]);
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: longPollClose }; } $f.$ptr = $ptr; $f._r = _r; $f.action = action; $f.c = c; $f.s = s; $f.url = url; $f.$s = $s; $f.$r = $r; return $f;
	};
	logErrorResponse = function(s, channel, prefix) {
		var $ptr, _r, channel, prefix, resp, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; channel = $f.channel; prefix = $f.prefix; resp = $f.resp; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = $recv(channel); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		resp = $clone(_r[0], httpResponse);
		/* */ if (!($interfaceIsEqual(resp.err, $ifaceNil))) { $s = 2; continue; }
		/* */ $s = 3; continue;
		/* if (!($interfaceIsEqual(resp.err, $ifaceNil))) { */ case 2:
			$r = s.log(new sliceType$1([new $String(prefix), resp.err])); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 3:
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: logErrorResponse }; } $f.$ptr = $ptr; $f._r = _r; $f.channel = channel; $f.prefix = prefix; $f.resp = resp; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	randFloat64 = function() {
		var $ptr;
		return $parseFloat($global.Math.random());
	};
	Session.ptr.prototype.SetParams = function(params) {
		var $ptr, _entry, _entry$1, _tuple, found, params, s, x;
		s = this;
		if ($interfaceIsEqual((_entry = params[$String.keyFor("message_types")], _entry !== undefined ? _entry.v : $ifaceNil), $ifaceNil)) {
			$panic(new $String("message_types parameter not defined"));
		}
		_tuple = (_entry$1 = params[$String.keyFor("session_id")], _entry$1 !== undefined ? [_entry$1.v, true] : [$ifaceNil, false]);
		x = _tuple[0];
		found = _tuple[1];
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			s.sessionId = x;
		} else if (found) {
			delete params[$String.keyFor("session_id")];
		}
		s.sessionParams = params;
		if (!(s.sendNotify === $chanNil) && !s.running) {
			s.running = true;
			$go($methodVal(s, "discover"), []);
		}
	};
	Session.prototype.SetParams = function(params) { return this.$val.SetParams(params); };
	Session.ptr.prototype.SetTransport = function(name) {
		var $ptr, _1, name, s;
		s = this;
		if (name === "") {
			s.forceLongPoll = false;
			return;
		}
		_1 = name;
		if (_1 === "websocket") {
			$panic(new $String("websocket transport cannot be forced"));
		} else if (_1 === "longpoll") {
			s.forceLongPoll = true;
		} else {
			$panic(new $String("unknown transport: " + name));
		}
	};
	Session.prototype.SetTransport = function(name) { return this.$val.SetTransport(name); };
	Session.ptr.prototype.Open = function() {
		var $ptr, s;
		s = this;
		if (s.closed) {
			$panic(new $String("session already closed"));
		}
		if (!(s.sendNotify === $chanNil)) {
			$panic(new $String("session already initialized"));
		}
		if (s.OnSessionEvent === $throwNilPointerError) {
			$panic(new $String("onSessionEvent callback not defined"));
		}
		if (s.OnEvent === $throwNilPointerError) {
			$panic(new $String("onEvent callback not defined"));
		}
		if (s.sessionParams === false) {
			$panic(new $String("session parameters not defined"));
		}
		s.sendNotify = new $Chan(structType, 1);
		s.closeNotify = new $Chan(structType, 1);
		s.running = true;
		$go($methodVal(s, "discover"), []);
	};
	Session.prototype.Open = function() { return this.$val.Open(); };
	Session.ptr.prototype.Close = function() {
		var $ptr, _i, _ref, action, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _i = $f._i; _ref = $f._ref; action = $f.action; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		s = [s];
		s[0] = this;
		if (s[0].closed) {
			return;
		}
		_ref = s[0].sendBuffer;
		_i = 0;
		/* while (true) { */ case 1:
			/* if (!(_i < _ref.$length)) { break; } */ if(!(_i < _ref.$length)) { $s = 2; continue; }
			action = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			/* */ if (!(action.OnReply === $throwNilPointerError)) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (!(action.OnReply === $throwNilPointerError)) { */ case 3:
				$r = action.OnReply(ptrType.nil); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* } */ case 4:
			_i++;
		/* } */ $s = 1; continue; case 2:
		s[0].sendBuffer = sliceType$5.nil;
		s[0].numSent = 0;
		s[0].closed = true;
		s[0].running = false;
		$go((function(s) { return function $b() {
			var $ptr, $s, $r;
			/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
			$r = $send(s[0].closeNotify, new structType.ptr()); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			$close(s[0].sendNotify);
			/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f.$s = $s; $f.$r = $r; return $f;
		}; })(s), []);
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: Session.ptr.prototype.Close }; } $f.$ptr = $ptr; $f._i = _i; $f._ref = _ref; $f.action = action; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	Session.prototype.Close = function() { return this.$val.Close(); };
	Session.ptr.prototype.Send = function(action) {
		var $ptr, _entry, _key, _tuple, action, found, s, x, x$1, x$2;
		s = this;
		if (s.sendNotify === $chanNil) {
			$panic(new $String("session not initialized"));
		}
		if (s.closed) {
			$panic(new $String("session already closed"));
		}
		if (action.Payload.$length === 0) {
			action.Payload = sliceType$2.nil;
		}
		_tuple = (_entry = action.Params[$String.keyFor("action_id")], _entry !== undefined ? [_entry.v, true] : [$ifaceNil, false]);
		x = _tuple[0];
		found = _tuple[1];
		if (found && $interfaceIsEqual(x, $ifaceNil)) {
			delete action.Params[$String.keyFor("action_id")];
		} else {
			s.lastActionId = (x$1 = s.lastActionId, x$2 = new $Int64(0, 1), new $Int64(x$1.$high + x$2.$high, x$1.$low + x$2.$low));
			action.id = s.lastActionId;
			_key = "action_id"; (action.Params || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key)] = { k: _key, v: action.id };
		}
		s.send(action);
		return;
	};
	Session.prototype.Send = function(action) { return this.$val.Send(action); };
	Session.ptr.prototype.send = function(action) {
		var $ptr, action, s;
		s = this;
		s.sendBuffer = $append(s.sendBuffer, action);
		$go((function $b() {
			var $ptr, _selection, $r;
			/* */ var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _selection = $f._selection; $r = $f.$r; }
			_selection = $select([[s.sendNotify, new structType.ptr()], []]);
			if (_selection[0] === 0) {
			} else if (_selection[0] === 1) {
			}
			/* */ if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f._selection = _selection; $f.$r = $r; return $f;
		}), []);
		return;
	};
	Session.prototype.send = function(action) { return this.$val.send(action); };
	Session.ptr.prototype.sendAck = function() {
		var $ptr, s;
		s = this;
		s.sendEventAck = true;
		$go((function $b() {
			var $ptr, _selection, $r;
			/* */ var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _selection = $f._selection; $r = $f.$r; }
			_selection = $select([[s.sendNotify, new structType.ptr()], []]);
			if (_selection[0] === 0) {
			} else if (_selection[0] === 1) {
			}
			/* */ if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f._selection = _selection; $f.$r = $r; return $f;
		}), []);
	};
	Session.prototype.sendAck = function() { return this.$val.sendAck(); };
	Session.ptr.prototype.discover = function() {
		var $ptr, _r, _r$1, _r$2, _r$3, _r$4, _selection, _tuple, _tuple$1, backoff$1, endpoint, err, err$1, hosts, request, response, s, url, $s, $deferred, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; _selection = $f._selection; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; backoff$1 = $f.backoff$1; endpoint = $f.endpoint; err = $f.err; err$1 = $f.err$1; hosts = $f.hosts; request = $f.request; response = $f.response; s = $f.s; url = $f.url; $s = $f.$s; $deferred = $f.$deferred; $r = $f.$r; } var $err = null; try { s: while (true) { switch ($s) { case 0: $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		backoff$1 = [backoff$1];
		s = [s];
		s[0] = this;
		$r = s[0].log(new sliceType$1([new $String("opening")])); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$deferred.push([$methodVal(s[0], "log"), [new sliceType$1([new $String("closed")])]]);
		$deferred.push([(function(backoff$1, s) { return function $b() {
			var $ptr, $s, $r;
			/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
			/* */ if (s[0].closed && !(s[0].OnClose === $throwNilPointerError)) { $s = 1; continue; }
			/* */ $s = 2; continue;
			/* if (s[0].closed && !(s[0].OnClose === $throwNilPointerError)) { */ case 1:
				$r = s[0].OnClose(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* } */ case 2:
			/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f.$s = $s; $f.$r = $r; return $f;
		}; })(backoff$1, s), []]);
		$deferred.push([$methodVal(s[0], "connState"), ["disconnected"]]);
		backoff$1[0] = new backoff.ptr(0);
		/* while (true) { */ case 2:
			/* if (!(s[0].running)) { break; } */ if(!(s[0].running)) { $s = 3; continue; }
			endpoint = [endpoint];
			$r = s[0].log(new sliceType$1([new $String("endpoint discovery")])); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			$r = s[0].connState("connecting"); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			url = "https://" + getAddress(s[0].Address) + "/v2/endpoint";
			_tuple = newGETRequest(url);
			request = _tuple[0];
			err = _tuple[1];
			if (!($interfaceIsEqual(err, $ifaceNil))) {
				$panic(err);
			}
			_r = getResponseChannel(request, jitterDuration(new duration(0, 7000), 0.1)); /* */ $s = 6; case 6: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			_r$1 = $select([[_r], [s[0].closeNotify]]); /* */ $s = 7; case 7: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			_selection = _r$1;
			/* */ if (_selection[0] === 0) { $s = 8; continue; }
			/* */ if (_selection[0] === 1) { $s = 9; continue; }
			/* */ $s = 10; continue;
			/* if (_selection[0] === 0) { */ case 8:
				response = $clone(_selection[1][0], httpResponse);
				hosts = sliceType.nil;
				err$1 = response.err;
				if ($interfaceIsEqual(err$1, $ifaceNil)) {
					endpoint[0] = false;
					err$1 = jsonUnmarshalObject(response.data, (endpoint.$ptr || (endpoint.$ptr = new ptrType$2(function() { return this.$target[0]; }, function($v) { this.$target[0] = $v; }, endpoint))));
					if ($interfaceIsEqual(err$1, $ifaceNil)) {
						_tuple$1 = getEndpointHosts(endpoint[0]);
						hosts = _tuple$1[0];
						err$1 = _tuple$1[1];
					}
				}
				/* */ if ($interfaceIsEqual(err$1, $ifaceNil)) { $s = 11; continue; }
				/* */ $s = 12; continue;
				/* if ($interfaceIsEqual(err$1, $ifaceNil)) { */ case 11:
					$r = s[0].log(new sliceType$1([new $String("endpoint discovered")])); /* */ $s = 14; case 14: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					/* */ if (webSocketSupported && !s[0].forceLongPoll) { $s = 15; continue; }
					/* */ $s = 16; continue;
					/* if (webSocketSupported && !s[0].forceLongPoll) { */ case 15:
						_r$2 = s[0].connect(webSocketTransport, hosts, backoff$1[0]); /* */ $s = 19; case 19: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
						/* */ if (_r$2) { $s = 17; continue; }
						/* */ $s = 18; continue;
						/* if (_r$2) { */ case 17:
							/* continue; */ $s = 2; continue;
						/* } */ case 18:
					/* } */ case 16:
					_r$3 = s[0].connect(longPollTransport, hosts, backoff$1[0]); /* */ $s = 20; case 20: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
					_r$3;
					$s = 13; continue;
				/* } else { */ case 12:
					$r = s[0].log(new sliceType$1([new $String("endpoint discovery:"), err$1])); /* */ $s = 21; case 21: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				/* } */ case 13:
				$s = 10; continue;
			/* } else if (_selection[0] === 1) { */ case 9:
				return;
			/* } */ case 10:
			_r$4 = s[0].backOff(backoff$1[0]); /* */ $s = 24; case 24: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
			/* */ if (!_r$4) { $s = 22; continue; }
			/* */ $s = 23; continue;
			/* if (!_r$4) { */ case 22:
				return;
			/* } */ case 23:
		/* } */ $s = 2; continue; case 3:
		/* */ $s = -1; case -1: } return; } } catch(err) { $err = err; $s = -1; } finally { $callDeferred($deferred, $err); if($curGoroutine.asleep) { if ($f === undefined) { $f = { $blk: Session.ptr.prototype.discover }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._selection = _selection; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f.backoff$1 = backoff$1; $f.endpoint = endpoint; $f.err = err; $f.err$1 = err$1; $f.hosts = hosts; $f.request = request; $f.response = response; $f.s = s; $f.url = url; $f.$s = $s; $f.$deferred = $deferred; $f.$r = $r; return $f; } }
	};
	Session.prototype.discover = function() { return this.$val.discover(); };
	Session.ptr.prototype.connect = function(transport$1, hosts, backoff$1) {
		var $ptr, _i, _i$1, _r, _r$1, _ref, _ref$1, _rune, _tuple, backoff$1, c, connWorked, gotOnline, host, hosts, i, s, transport$1, transportWorked, trial, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _i = $f._i; _i$1 = $f._i$1; _r = $f._r; _r$1 = $f._r$1; _ref = $f._ref; _ref$1 = $f._ref$1; _rune = $f._rune; _tuple = $f._tuple; backoff$1 = $f.backoff$1; c = $f.c; connWorked = $f.connWorked; gotOnline = $f.gotOnline; host = $f.host; hosts = $f.hosts; i = $f.i; s = $f.s; transport$1 = $f.transport$1; transportWorked = $f.transportWorked; trial = $f.trial; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		transportWorked = false;
		s = this;
		trial = 0;
		/* while (true) { */ case 1:
			/* if (!(trial < 2)) { break; } */ if(!(trial < 2)) { $s = 2; continue; }
			_ref = hosts;
			_i = 0;
			/* while (true) { */ case 3:
				/* if (!(_i < _ref.$length)) { break; } */ if(!(_i < _ref.$length)) { $s = 4; continue; }
				host = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
				$r = s.connState("connecting"); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				_ref$1 = s.Address;
				_i$1 = 0;
				while (true) {
					if (!(_i$1 < _ref$1.length)) { break; }
					_rune = $decodeRune(_ref$1, _i$1);
					i = _i$1;
					c = _rune[0];
					if (c === 47) {
						host = host + (s.Address.substring(i));
						break;
					}
					_i$1 += _rune[1];
				}
				_r = transport$1(s, host); /* */ $s = 6; case 6: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				_tuple = _r;
				connWorked = _tuple[0];
				gotOnline = _tuple[1];
				if (connWorked) {
					transportWorked = true;
				}
				if (gotOnline) {
					backoff$1.success();
					return transportWorked;
				}
				if (!s.running) {
					return transportWorked;
				}
				_r$1 = s.backOff(backoff$1); /* */ $s = 9; case 9: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
				/* */ if (!_r$1) { $s = 7; continue; }
				/* */ $s = 8; continue;
				/* if (!_r$1) { */ case 7:
					return transportWorked;
				/* } */ case 8:
				_i++;
			/* } */ $s = 3; continue; case 4:
			trial = trial + (1) >> 0;
		/* } */ $s = 1; continue; case 2:
		return transportWorked;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Session.ptr.prototype.connect }; } $f.$ptr = $ptr; $f._i = _i; $f._i$1 = _i$1; $f._r = _r; $f._r$1 = _r$1; $f._ref = _ref; $f._ref$1 = _ref$1; $f._rune = _rune; $f._tuple = _tuple; $f.backoff$1 = backoff$1; $f.c = c; $f.connWorked = connWorked; $f.gotOnline = gotOnline; $f.host = host; $f.hosts = hosts; $f.i = i; $f.s = s; $f.transport$1 = transport$1; $f.transportWorked = transportWorked; $f.trial = trial; $f.$s = $s; $f.$r = $r; return $f;
	};
	Session.prototype.connect = function(transport$1, hosts, backoff$1) { return this.$val.connect(transport$1, hosts, backoff$1); };
	Session.ptr.prototype.backOff = function(b) {
		var $ptr, _r, _selection, b, delay, ok, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _selection = $f._selection; b = $f.b; delay = $f.delay; ok = $f.ok; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		ok = false;
		s = this;
		delay = b.failure(new duration(0, 60000));
		if ((delay.$high === 0 && delay.$low === 0)) {
			ok = true;
			return ok;
		}
		$r = s.log(new sliceType$1([new $String("sleeping")])); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = s.connState("disconnected"); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		_r = $select([[newTimer(delay).C], [s.closeNotify]]); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_selection = _r;
		if (_selection[0] === 0) {
			ok = true;
		} else if (_selection[0] === 1) {
		}
		return ok;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Session.ptr.prototype.backOff }; } $f.$ptr = $ptr; $f._r = _r; $f._selection = _selection; $f.b = b; $f.delay = delay; $f.ok = ok; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	Session.prototype.backOff = function(b) { return this.$val.backOff(b); };
	Session.ptr.prototype.canLogin = function() {
		var $ptr, _entry, _entry$1, _entry$2, _entry$3, _entry$4, _entry$5, _entry$6, s;
		s = this;
		if (!($interfaceIsEqual((_entry = s.sessionParams[$String.keyFor("access_key")], _entry !== undefined ? _entry.v : $ifaceNil), $ifaceNil))) {
			return true;
		}
		if (!($interfaceIsEqual((_entry$1 = s.sessionParams[$String.keyFor("user_id")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil), $ifaceNil))) {
			return !($interfaceIsEqual((_entry$2 = s.sessionParams[$String.keyFor("user_auth")], _entry$2 !== undefined ? _entry$2.v : $ifaceNil), $ifaceNil)) || !($interfaceIsEqual((_entry$3 = s.sessionParams[$String.keyFor("master_sign")], _entry$3 !== undefined ? _entry$3.v : $ifaceNil), $ifaceNil));
		}
		return !($interfaceIsEqual((_entry$4 = s.sessionParams[$String.keyFor("identity_type")], _entry$4 !== undefined ? _entry$4.v : $ifaceNil), $ifaceNil)) && !($interfaceIsEqual((_entry$5 = s.sessionParams[$String.keyFor("identity_name")], _entry$5 !== undefined ? _entry$5.v : $ifaceNil), $ifaceNil)) && !($interfaceIsEqual((_entry$6 = s.sessionParams[$String.keyFor("identity_auth")], _entry$6 !== undefined ? _entry$6.v : $ifaceNil), $ifaceNil));
	};
	Session.prototype.canLogin = function() { return this.$val.canLogin(); };
	Session.ptr.prototype.makeCreateSessionAction = function() {
		var $ptr, _2, _entry, _entry$1, _entry$2, _entry$3, _entry$4, _entry$5, _entry$6, _entry$7, _i, _i$1, _key, _key$1, _key$2, _key$3, _key$4, _key$5, _key$6, _key$7, _key$8, _key$9, _keys, _keys$1, _ref, _ref$1, identityType, key, key$1, masterSign, params, s, userAuth, userId, value, value$1;
		params = false;
		s = this;
		params = $makeMap($String.keyFor, [{ k: "action", v: new $String("create_session") }]);
		userId = (_entry = s.sessionParams[$String.keyFor("user_id")], _entry !== undefined ? _entry.v : $ifaceNil);
		if ($interfaceIsEqual(userId, $ifaceNil)) {
			_ref = s.sessionParams;
			_i = 0;
			_keys = $keys(_ref);
			while (true) {
				if (!(_i < _keys.length)) { break; }
				_entry$1 = _ref[_keys[_i]];
				if (_entry$1 === undefined) {
					_i++;
					continue;
				}
				key = _entry$1.k;
				value = _entry$1.v;
				_key = key; (params || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key)] = { k: _key, v: value };
				_i++;
			}
		} else {
			userAuth = (_entry$2 = s.sessionParams[$String.keyFor("user_auth")], _entry$2 !== undefined ? _entry$2.v : $ifaceNil);
			if (!($interfaceIsEqual(userAuth, $ifaceNil))) {
				_key$1 = "user_id"; (params || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key$1)] = { k: _key$1, v: userId };
				_key$2 = "user_auth"; (params || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key$2)] = { k: _key$2, v: userAuth };
			} else {
				masterSign = (_entry$3 = s.sessionParams[$String.keyFor("master_sign")], _entry$3 !== undefined ? _entry$3.v : $ifaceNil);
				if (!($interfaceIsEqual(masterSign, $ifaceNil))) {
					_key$3 = "user_id"; (params || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key$3)] = { k: _key$3, v: userId };
					_key$4 = "master_sign"; (params || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key$4)] = { k: _key$4, v: masterSign };
				} else {
					identityType = (_entry$4 = s.sessionParams[$String.keyFor("identity_type")], _entry$4 !== undefined ? _entry$4.v : $ifaceNil);
					if (!($interfaceIsEqual(identityType, $ifaceNil))) {
						_key$5 = "identity_type"; (params || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key$5)] = { k: _key$5, v: identityType };
						_key$6 = "identity_name"; (params || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key$6)] = { k: _key$6, v: (_entry$5 = s.sessionParams[$String.keyFor("identity_name")], _entry$5 !== undefined ? _entry$5.v : $ifaceNil) };
						_key$7 = "identity_auth"; (params || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key$7)] = { k: _key$7, v: (_entry$6 = s.sessionParams[$String.keyFor("identity_auth")], _entry$6 !== undefined ? _entry$6.v : $ifaceNil) };
					} else {
						_key$8 = "user_id"; (params || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key$8)] = { k: _key$8, v: userId };
					}
				}
			}
			_ref$1 = s.sessionParams;
			_i$1 = 0;
			_keys$1 = $keys(_ref$1);
			while (true) {
				if (!(_i$1 < _keys$1.length)) { break; }
				_entry$7 = _ref$1[_keys$1[_i$1]];
				if (_entry$7 === undefined) {
					_i$1++;
					continue;
				}
				key$1 = _entry$7.k;
				value$1 = _entry$7.v;
				_2 = key$1;
				if (_2 === "user_id" || _2 === "user_auth" || _2 === "identity_type" || _2 === "identity_name" || _2 === "identity_auth" || _2 === "access_key" || _2 === "master_sign") {
				} else {
					_key$9 = key$1; (params || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key$9)] = { k: _key$9, v: value$1 };
				}
				_i$1++;
			}
		}
		return params;
	};
	Session.prototype.makeCreateSessionAction = function() { return this.$val.makeCreateSessionAction(); };
	Session.ptr.prototype.makeResumeSessionAction = function(session) {
		var $ptr, _key, params, s, session;
		params = false;
		s = this;
		params = $makeMap($String.keyFor, [{ k: "action", v: new $String("resume_session") }, { k: "event_id", v: s.receivedEventId }]);
		if (session) {
			_key = "session_id"; (params || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key)] = { k: _key, v: s.sessionId };
		}
		s.sendEventAck = false;
		s.ackedEventId = s.receivedEventId;
		return params;
	};
	Session.prototype.makeResumeSessionAction = function(session) { return this.$val.makeResumeSessionAction(session); };
	Session.ptr.prototype.handleSessionEvent = function(params) {
		var $ptr, _3, _entry, _entry$1, _entry$2, _entry$3, _i, _key, _key$1, _key$2, _ref, _tuple, _tuple$1, errorType, event, newValue, ok, param, params, quit, s, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _3 = $f._3; _entry = $f._entry; _entry$1 = $f._entry$1; _entry$2 = $f._entry$2; _entry$3 = $f._entry$3; _i = $f._i; _key = $f._key; _key$1 = $f._key$1; _key$2 = $f._key$2; _ref = $f._ref; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; errorType = $f.errorType; event = $f.event; newValue = $f.newValue; ok = $f.ok; param = $f.param; params = $f.params; quit = $f.quit; s = $f.s; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		ok = false;
		s = this;
		event = new Event.ptr(params, sliceType$2.nil, false);
		quit = false;
		if (event.String() === "error") {
			s.sessionId = $ifaceNil;
			quit = true;
			_tuple = event.Str("error_type");
			errorType = _tuple[0];
			_3 = errorType;
			if (_3 === "internal") {
			} else {
				s.running = false;
			}
		}
		$r = s.OnSessionEvent(event); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		if (quit) {
			return ok;
		}
		delete s.sessionParams[$String.keyFor("user_attrs")];
		delete s.sessionParams[$String.keyFor("user_settings")];
		delete s.sessionParams[$String.keyFor("identity_attrs")];
		delete s.sessionParams[$String.keyFor("access_key")];
		delete s.sessionParams[$String.keyFor("master_sign")];
		_key = "user_id"; (s.sessionParams || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key)] = { k: _key, v: (_entry = event.Params[$String.keyFor("user_id")], _entry !== undefined ? _entry.v : $ifaceNil) };
		x = (_entry$1 = event.Params[$String.keyFor("user_auth")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_key$1 = "user_auth"; (s.sessionParams || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key$1)] = { k: _key$1, v: x };
		}
		_ref = new sliceType(["identity_type", "identity_name", "identity_auth"]);
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			param = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			newValue = (_entry$2 = s.sessionParams[$String.keyFor(param + "_new")], _entry$2 !== undefined ? _entry$2.v : $ifaceNil);
			if (!($interfaceIsEqual(newValue, $ifaceNil))) {
				delete s.sessionParams[$String.keyFor(param + "_new")];
				_key$2 = param; (s.sessionParams || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key$2)] = { k: _key$2, v: newValue };
			}
			_i++;
		}
		s.sessionId = (_entry$3 = event.Params[$String.keyFor("session_id")], _entry$3 !== undefined ? _entry$3.v : $ifaceNil);
		if (s.sendBuffer.$length === 0) {
			s.lastActionId = new $Int64(0, 0);
		}
		s.sendEventAck = false;
		_tuple$1 = event.Int64("event_id");
		s.receivedEventId = _tuple$1[0];
		s.ackedEventId = new $Int64(0, 0);
		$r = s.log(new sliceType$1([new $String("session created")])); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		ok = true;
		return ok;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Session.ptr.prototype.handleSessionEvent }; } $f.$ptr = $ptr; $f._3 = _3; $f._entry = _entry; $f._entry$1 = _entry$1; $f._entry$2 = _entry$2; $f._entry$3 = _entry$3; $f._i = _i; $f._key = _key; $f._key$1 = _key$1; $f._key$2 = _key$2; $f._ref = _ref; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f.errorType = errorType; $f.event = event; $f.newValue = newValue; $f.ok = ok; $f.param = param; $f.params = params; $f.quit = quit; $f.s = s; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	Session.prototype.handleSessionEvent = function(params) { return this.$val.handleSessionEvent(params); };
	Session.ptr.prototype.handleEvent = function(event) {
		var $ptr, _r, _tuple, _tuple$1, _tuple$2, action, actionId, err, errorReason, errorType, event, eventId, i, needsAck, ok, s, sessionLost, x, x$1, x$2, x$3, x$4, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; _tuple$2 = $f._tuple$2; action = $f.action; actionId = $f.actionId; err = $f.err; errorReason = $f.errorReason; errorType = $f.errorType; event = $f.event; eventId = $f.eventId; i = $f.i; needsAck = $f.needsAck; ok = $f.ok; s = $f.s; sessionLost = $f.sessionLost; x = $f.x; x$1 = $f.x$1; x$2 = $f.x$2; x$3 = $f.x$3; x$4 = $f.x$4; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		actionId = [actionId];
		s = [s];
		actionId[0] = new $Int64(0, 0);
		sessionLost = false;
		needsAck = false;
		ok = false;
		s[0] = this;
		_tuple = event.Int64("event_id");
		eventId = _tuple[0];
		if ((eventId.$high > 0 || (eventId.$high === 0 && eventId.$low > 0))) {
			s[0].receivedEventId = eventId;
			if (!s[0].sendEventAck) {
				if ((x = (x$1 = s[0].receivedEventId, x$2 = s[0].ackedEventId, new $Int64(x$1.$high - x$2.$high, x$1.$low - x$2.$low)), (x.$high > sessionEventAckWindow.$high || (x.$high === sessionEventAckWindow.$high && x.$low >= sessionEventAckWindow.$low)))) {
					s[0].sendAck();
				} else {
					needsAck = true;
				}
			}
		}
		_tuple$1 = event.Int64("action_id");
		actionId[0] = _tuple$1[0];
		/* */ if ((actionId[0].$high > 0 || (actionId[0].$high === 0 && actionId[0].$low > 0))) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if ((actionId[0].$high > 0 || (actionId[0].$high === 0 && actionId[0].$low > 0))) { */ case 1:
			_r = sort.Search(s[0].numSent, (function(actionId, s) { return function(i) {
				var $ptr, action, i, x$3, x$4;
				action = (x$3 = s[0].sendBuffer, ((i < 0 || i >= x$3.$length) ? $throwRuntimeError("index out of range") : x$3.$array[x$3.$offset + i]));
				return (x$4 = action.id, (x$4.$high > actionId[0].$high || (x$4.$high === actionId[0].$high && x$4.$low >= actionId[0].$low)));
			}; })(actionId, s)); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			i = _r;
			/* */ if (i < s[0].numSent) { $s = 4; continue; }
			/* */ $s = 5; continue;
			/* if (i < s[0].numSent) { */ case 4:
				action = (x$3 = s[0].sendBuffer, ((i < 0 || i >= x$3.$length) ? $throwRuntimeError("index out of range") : x$3.$array[x$3.$offset + i]));
				/* */ if ((x$4 = action.id, (x$4.$high === actionId[0].$high && x$4.$low === actionId[0].$low))) { $s = 6; continue; }
				/* */ $s = 7; continue;
				/* if ((x$4 = action.id, (x$4.$high === actionId[0].$high && x$4.$low === actionId[0].$low))) { */ case 6:
					event.initLastReply(action);
					/* */ if (!(action.OnReply === $throwNilPointerError)) { $s = 8; continue; }
					/* */ $s = 9; continue;
					/* if (!(action.OnReply === $throwNilPointerError)) { */ case 8:
						$r = action.OnReply(event); /* */ $s = 10; case 10: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					/* } */ case 9:
					if (event.LastReply) {
						s[0].sendBuffer = $appendSlice($subslice(s[0].sendBuffer, 0, i), $subslice(s[0].sendBuffer, (i + 1 >> 0)));
						s[0].numSent = s[0].numSent - (1) >> 0;
					}
				/* } */ case 7:
			/* } */ case 5:
		/* } */ case 2:
		/* */ if (event.String() === "user_deleted") { $s = 11; continue; }
		/* */ $s = 12; continue;
		/* if (event.String() === "user_deleted") { */ case 11:
			s[0].sessionId = $ifaceNil;
			s[0].running = false;
			$r = s[0].OnSessionEvent(event); /* */ $s = 13; case 13: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			sessionLost = true;
			return [actionId[0], sessionLost, needsAck, ok];
		/* } */ case 12:
		_tuple$2 = event.getError();
		errorType = _tuple$2[0];
		errorReason = _tuple$2[1];
		sessionLost = _tuple$2[2];
		err = _tuple$2[3];
		/* */ if (!($interfaceIsEqual(err, $ifaceNil))) { $s = 14; continue; }
		/* */ $s = 15; continue;
		/* if (!($interfaceIsEqual(err, $ifaceNil))) { */ case 14:
			$r = s[0].log(new sliceType$1([new $String("event:"), err])); /* */ $s = 16; case 16: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* */ if (sessionLost) { $s = 17; continue; }
			/* */ $s = 18; continue;
			/* if (sessionLost) { */ case 17:
				s[0].sessionId = $ifaceNil;
				/* */ if (!s[0].canLogin()) { $s = 19; continue; }
				/* */ $s = 20; continue;
				/* if (!s[0].canLogin()) { */ case 19:
					s[0].running = false;
					$r = s[0].OnSessionEvent(event); /* */ $s = 21; case 21: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				/* } */ case 20:
			/* } */ case 18:
			return [actionId[0], sessionLost, needsAck, ok];
		/* } */ case 15:
		/* */ if (errorType === "deprecated") { $s = 22; continue; }
		/* */ $s = 23; continue;
		/* if (errorType === "deprecated") { */ case 22:
			$r = s[0].log(new sliceType$1([new $String("deprecated:"), new $String(errorReason)])); /* */ $s = 24; case 24: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 23:
		$r = s[0].OnEvent(event); /* */ $s = 25; case 25: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		ok = true;
		return [actionId[0], sessionLost, needsAck, ok];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Session.ptr.prototype.handleEvent }; } $f.$ptr = $ptr; $f._r = _r; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f._tuple$2 = _tuple$2; $f.action = action; $f.actionId = actionId; $f.err = err; $f.errorReason = errorReason; $f.errorType = errorType; $f.event = event; $f.eventId = eventId; $f.i = i; $f.needsAck = needsAck; $f.ok = ok; $f.s = s; $f.sessionLost = sessionLost; $f.x = x; $f.x$1 = x$1; $f.x$2 = x$2; $f.x$3 = x$3; $f.x$4 = x$4; $f.$s = $s; $f.$r = $r; return $f;
	};
	Session.prototype.handleEvent = function(event) { return this.$val.handleEvent(event); };
	Session.ptr.prototype.connState = function(state) {
		var $ptr, s, state, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; s = $f.s; state = $f.state; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		s = this;
		/* */ if (!(s.latestConnState === state)) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!(s.latestConnState === state)) { */ case 1:
			s.latestConnState = state;
			/* */ if (!(s.OnConnState === $throwNilPointerError)) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (!(s.OnConnState === $throwNilPointerError)) { */ case 3:
				$r = s.OnConnState(s.latestConnState); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* } */ case 4:
		/* } */ case 2:
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: Session.ptr.prototype.connState }; } $f.$ptr = $ptr; $f.s = s; $f.state = state; $f.$s = $s; $f.$r = $r; return $f;
	};
	Session.prototype.connState = function(state) { return this.$val.connState(state); };
	Session.ptr.prototype.connActive = function() {
		var $ptr, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		s = this;
		/* */ if (!(s.OnConnActive === $throwNilPointerError)) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!(s.OnConnActive === $throwNilPointerError)) { */ case 1:
			$r = s.OnConnActive(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 2:
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: Session.ptr.prototype.connActive }; } $f.$ptr = $ptr; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	Session.prototype.connActive = function() { return this.$val.connActive(); };
	Session.ptr.prototype.log = function(tokens) {
		var $ptr, s, tokens, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; s = $f.s; tokens = $f.tokens; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		s = this;
		/* */ if (!(s.OnLog === $throwNilPointerError)) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!(s.OnLog === $throwNilPointerError)) { */ case 1:
			$r = s.OnLog(tokens); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 2:
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: Session.ptr.prototype.log }; } $f.$ptr = $ptr; $f.s = s; $f.tokens = tokens; $f.$s = $s; $f.$r = $r; return $f;
	};
	Session.prototype.log = function(tokens) { return this.$val.log(tokens); };
	newTimer = function(timeout) {
		var $ptr, t, timeout;
		t = ptrType$7.nil;
		t = new timer.ptr(new $Chan(structType, 0), null);
		if ((timeout.$high > 0 || (timeout.$high === 0 && timeout.$low >= 0))) {
			t.Reset(timeout);
		}
		return t;
	};
	timer.ptr.prototype.Active = function() {
		var $ptr, timer$1;
		timer$1 = this;
		return !(timer$1.id === null);
	};
	timer.prototype.Active = function() { return this.$val.Active(); };
	timer.ptr.prototype.Reset = function(timeout) {
		var $ptr, timeout, timer$1;
		timer$1 = this;
		timer$1.Stop();
		timer$1.id = $global.setTimeout($externalize((function() {
			var $ptr;
			timer$1.id = null;
			$go((function $b() {
				var $ptr, $s, $r;
				/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
				$r = $send(timer$1.C, new structType.ptr()); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f.$s = $s; $f.$r = $r; return $f;
			}), []);
		}), funcType), $externalize(timeout, duration));
	};
	timer.prototype.Reset = function(timeout) { return this.$val.Reset(timeout); };
	timer.ptr.prototype.Stop = function() {
		var $ptr, timer$1;
		timer$1 = this;
		if (!(timer$1.id === null)) {
			$global.clearTimeout(timer$1.id);
			timer$1.id = null;
		}
	};
	timer.prototype.Stop = function() { return this.$val.Stop(); };
	init$1 = function() {
		var $ptr, class$1;
		class$1 = $global.WebSocket;
		webSocketSupported = !(class$1 === undefined) && !(class$1.CLOSING === undefined);
	};
	newWebSocket = function(url, timeout) {
		var $ptr, clearTimeout, closeNotify, notifyClosed, timeout, timeoutId, url, ws;
		ws = ptrType$8.nil;
		ws = new webSocket.ptr(new $Chan(structType, 1), false, $ifaceNil, new ($global.WebSocket)($externalize(url, $String)), false, sliceType$6.nil);
		ws.impl.binaryType = $externalize("arraybuffer", $String);
		notifyClosed = false;
		closeNotify = (function() {
			var $ptr;
			if (!notifyClosed) {
				notifyClosed = true;
				$go((function() {
					var $ptr;
					$close(ws.notify);
				}), []);
			}
		});
		timeoutId = $global.setTimeout($externalize((function $b() {
			var $ptr, $s, $r;
			/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
			ws.err = errors.New("timeout");
			$r = closeNotify(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f.$s = $s; $f.$r = $r; return $f;
		}), funcType), $externalize(timeout, duration));
		clearTimeout = (function() {
			var $ptr;
			if (!(timeoutId === null)) {
				$global.clearTimeout(timeoutId);
				timeoutId = null;
			}
		});
		ws.impl.onopen = $externalize((function $b(param) {
			var $ptr, param, $s, $r;
			/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; param = $f.param; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
			$r = clearTimeout(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			if (!($interfaceIsEqual(ws.err, $ifaceNil))) {
				ws.impl.close();
				return;
			}
			ws.open = true;
			$go((function $b() {
				var $ptr, $s, $r;
				/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
				/* */ if (!notifyClosed) { $s = 1; continue; }
				/* */ $s = 2; continue;
				/* if (!notifyClosed) { */ case 1:
					$r = $send(ws.notify, new structType.ptr()); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				/* } */ case 2:
				/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f.$s = $s; $f.$r = $r; return $f;
			}), []);
			/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f.param = param; $f.$s = $s; $f.$r = $r; return $f;
		}), funcType$1);
		ws.impl.onmessage = $externalize((function(object) {
			var $ptr, object;
			ws.buf = $append(ws.buf, object.data);
			$go((function $b() {
				var $ptr, _selection, $r;
				/* */ var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _selection = $f._selection; $r = $f.$r; }
				if (!notifyClosed) {
					_selection = $select([[ws.notify, new structType.ptr()], []]);
					if (_selection[0] === 0) {
					} else if (_selection[0] === 1) {
					}
				}
				/* */ if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f._selection = _selection; $f.$r = $r; return $f;
			}), []);
		}), funcType$1);
		ws.impl.onclose = $externalize((function $b(object) {
			var $ptr, object, $s, $r;
			/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; object = $f.object; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
			ws.goingAway = (($parseInt(object.code) >> 0) === 1001);
			ws.open = false;
			$r = closeNotify(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f.object = object; $f.$s = $s; $f.$r = $r; return $f;
		}), funcType$1);
		ws.impl.onerror = $externalize((function $b(object) {
			var $ptr, object, $s, $r;
			/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; object = $f.object; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
			$r = clearTimeout(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			if ($interfaceIsEqual(ws.err, $ifaceNil)) {
				ws.err = errors.New($internalize(object.message, $String));
			}
			$r = closeNotify(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f.object = object; $f.$s = $s; $f.$r = $r; return $f;
		}), funcType$1);
		return ws;
	};
	webSocket.ptr.prototype.send = function(data) {
		var $ptr, data, err, ws, $deferred;
		/* */ var $err = null; try { $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		err = $ifaceNil;
		ws = this;
		$deferred.push([(function() {
			var $ptr;
			err = jsError($recover());
		}), []]);
		ws.impl.send(data);
		return err;
		/* */ } catch(err) { $err = err; } finally { $callDeferred($deferred, $err); if (!$curGoroutine.asleep) { return  err; } }
	};
	webSocket.prototype.send = function(data) { return this.$val.send(data); };
	webSocket.ptr.prototype.sendJSON = function(object) {
		var $ptr, _tuple, err, json, object, ws;
		err = $ifaceNil;
		ws = this;
		_tuple = jsonMarshal(object);
		json = _tuple[0];
		err = _tuple[1];
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			return err;
		}
		err = ws.send(json);
		return err;
	};
	webSocket.prototype.sendJSON = function(object) { return this.$val.sendJSON(object); };
	webSocket.ptr.prototype.sendPayload = function(action) {
		var $ptr, _i, _ref, action, array, base64, binaryString, data, decodeDataURI, err, frame, i, length, ws, $deferred;
		/* */ var $err = null; try { $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		err = $ifaceNil;
		ws = this;
		$deferred.push([(function() {
			var $ptr;
			err = jsError($recover());
		}), []]);
		decodeDataURI = action.String() === "update_user";
		_ref = action.Payload;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			frame = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			data = frame;
			if (decodeDataURI) {
				base64 = data.split($externalize(",", $String))[1];
				binaryString = $global.atob(base64);
				length = $parseInt(binaryString.length);
				data = new ($global.ArrayBuffer)(length);
				array = new ($global.Uint8Array)(data);
				i = 0;
				while (true) {
					if (!(i < length)) { break; }
					array[i] = binaryString.charCodeAt(i);
					i = i + (1) >> 0;
				}
			}
			ws.impl.send(data);
			_i++;
		}
		return err;
		/* */ } catch(err) { $err = err; } finally { $callDeferred($deferred, $err); if (!$curGoroutine.asleep) { return  err; } }
	};
	webSocket.prototype.sendPayload = function(action) { return this.$val.sendPayload(action); };
	webSocket.ptr.prototype.receive = function() {
		var $ptr, ws, x, x$1;
		x = null;
		ws = this;
		if (ws.buf.$length > 0) {
			x = (x$1 = ws.buf, (0 >= x$1.$length ? $throwRuntimeError("index out of range") : x$1.$array[x$1.$offset + 0]));
			ws.buf = $subslice(ws.buf, 1);
		}
		return x;
	};
	webSocket.prototype.receive = function() { return this.$val.receive(); };
	webSocket.ptr.prototype.receiveJSON = function() {
		var $ptr, err, object, object$24ptr, ws, x;
		object = false;
		err = $ifaceNil;
		ws = this;
		x = ws.receive();
		if (x === null) {
			return [object, err];
		}
		err = jsonUnmarshalObject(stringData(x), (object$24ptr || (object$24ptr = new ptrType$2(function() { return object; }, function($v) { object = $v; }))));
		return [object, err];
	};
	webSocket.prototype.receiveJSON = function() { return this.$val.receiveJSON(); };
	webSocket.ptr.prototype.close = function() {
		var $ptr, ws, $deferred;
		/* */ var $err = null; try { $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		ws = this;
		$deferred.push([(function() {
			var $ptr;
			$recover();
		}), []]);
		ws.impl.close();
		/* */ } catch(err) { $err = err; } finally { $callDeferred($deferred, $err); }
	};
	webSocket.prototype.close = function() { return this.$val.close(); };
	webSocketTransport = function(s, host) {
		var $ptr, _r, _r$1, _selection, _tuple, _tuple$1, connWorked, connected, goingAway, gotOnline, host, hostHealthy, s, ws, $s, $deferred, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _selection = $f._selection; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; connWorked = $f.connWorked; connected = $f.connected; goingAway = $f.goingAway; gotOnline = $f.gotOnline; host = $f.host; hostHealthy = $f.hostHealthy; s = $f.s; ws = $f.ws; $s = $f.$s; $deferred = $f.$deferred; $r = $f.$r; } var $err = null; try { s: while (true) { switch ($s) { case 0: $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		ws = [ws];
		connWorked = false;
		gotOnline = false;
		ws[0] = ptrType$8.nil;
		$deferred.push([(function(ws) { return function() {
			var $ptr;
			if (!(ws[0] === ptrType$8.nil)) {
				ws[0].close();
			}
		}; })(ws), []]);
		/* while (true) { */ case 1:
			gotOnline = false;
			hostHealthy = false;
			$r = s.log(new sliceType$1([new $String("connecting to"), new $String(host)])); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			ws[0] = newWebSocket("wss://" + host + "/v2/socket", jitterDuration(new duration(0, 9000), 0.1));
			_r = $select([[ws[0].notify], [s.closeNotify]]); /* */ $s = 4; case 4: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			_selection = _r;
			/* */ if (_selection[0] === 0) { $s = 5; continue; }
			/* */ if (_selection[0] === 1) { $s = 6; continue; }
			/* */ $s = 7; continue;
			/* if (_selection[0] === 0) { */ case 5:
				_tuple = _selection[1];
				connected = _tuple[1];
				/* */ if (connected) { $s = 8; continue; }
				/* */ $s = 9; continue;
				/* if (connected) { */ case 8:
					$r = s.log(new sliceType$1([new $String("connected")])); /* */ $s = 11; case 11: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					$r = s.connState("connected"); /* */ $s = 12; case 12: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					connWorked = true;
					_r$1 = webSocketHandshake(s, ws[0]); /* */ $s = 13; case 13: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
					_tuple$1 = _r$1;
					gotOnline = _tuple$1[0];
					hostHealthy = _tuple$1[1];
					$s = 10; continue;
				/* } else { */ case 9:
					$r = s.log(new sliceType$1([new $String("connection failed:"), ws[0].err])); /* */ $s = 14; case 14: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				/* } */ case 10:
				$s = 7; continue;
			/* } else if (_selection[0] === 1) { */ case 6:
			/* } */ case 7:
			goingAway = ws[0].goingAway;
			ws[0].close();
			ws[0] = ptrType$8.nil;
			/* */ if (goingAway) { $s = 15; continue; }
			/* */ $s = 16; continue;
			/* if (goingAway) { */ case 15:
				$r = s.log(new sliceType$1([new $String("disconnected (server is going away)")])); /* */ $s = 18; case 18: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				$s = 17; continue;
			/* } else { */ case 16:
				$r = s.log(new sliceType$1([new $String("disconnected")])); /* */ $s = 19; case 19: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* } */ case 17:
			if (!gotOnline || !hostHealthy || !s.running || goingAway) {
				return [connWorked, gotOnline];
			}
		/* } */ $s = 1; continue; case 2:
		/* */ $s = -1; case -1: } return; } } catch(err) { $err = err; $s = -1; } finally { $callDeferred($deferred, $err); if (!$curGoroutine.asleep) { return  [connWorked, gotOnline]; } if($curGoroutine.asleep) { if ($f === undefined) { $f = { $blk: webSocketTransport }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._selection = _selection; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f.connWorked = connWorked; $f.connected = connected; $f.goingAway = goingAway; $f.gotOnline = gotOnline; $f.host = host; $f.hostHealthy = hostHealthy; $f.s = s; $f.ws = ws; $f.$s = $s; $f.$deferred = $deferred; $f.$r = $r; return $f; } }
	};
	webSocketHandshake = function(s, ws) {
		var $ptr, _r, _r$1, _r$2, _r$3, _selection, _tuple, _tuple$1, _tuple$2, connected, done, err, err$1, fail, gotEvents, gotOnline, hostHealthy, params, params$1, s, timer$1, ws, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _selection = $f._selection; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; _tuple$2 = $f._tuple$2; connected = $f.connected; done = $f.done; err = $f.err; err$1 = $f.err$1; fail = $f.fail; gotEvents = $f.gotEvents; gotOnline = $f.gotOnline; hostHealthy = $f.hostHealthy; params = $f.params; params$1 = $f.params$1; s = $f.s; timer$1 = $f.timer$1; ws = $f.ws; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		gotOnline = false;
		hostHealthy = false;
		params = false;
		/* */ if ($interfaceIsEqual(s.sessionId, $ifaceNil)) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if ($interfaceIsEqual(s.sessionId, $ifaceNil)) { */ case 1:
			$r = s.log(new sliceType$1([new $String("session creation")])); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			params = s.makeCreateSessionAction();
			$s = 3; continue;
		/* } else { */ case 2:
			$r = s.log(new sliceType$1([new $String("session resumption")])); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			params = s.makeResumeSessionAction(true);
		/* } */ case 3:
		err = ws.sendJSON(params);
		/* */ if (!($interfaceIsEqual(err, $ifaceNil))) { $s = 6; continue; }
		/* */ $s = 7; continue;
		/* if (!($interfaceIsEqual(err, $ifaceNil))) { */ case 6:
			$r = s.log(new sliceType$1([new $String("send:"), err])); /* */ $s = 8; case 8: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 7:
		/* */ if ($interfaceIsEqual(s.sessionId, $ifaceNil)) { $s = 9; continue; }
		/* */ $s = 10; continue;
		/* if ($interfaceIsEqual(s.sessionId, $ifaceNil)) { */ case 9:
			params$1 = false;
			connected = true;
			timer$1 = newTimer(jitterDuration(new duration(0, 13000), 0.2));
			/* while (true) { */ case 11:
				err$1 = $ifaceNil;
				_tuple = ws.receiveJSON();
				params$1 = _tuple[0];
				err$1 = _tuple[1];
				/* */ if (!($interfaceIsEqual(err$1, $ifaceNil))) { $s = 13; continue; }
				/* */ $s = 14; continue;
				/* if (!($interfaceIsEqual(err$1, $ifaceNil))) { */ case 13:
					$r = s.log(new sliceType$1([new $String("session creation:"), err$1])); /* */ $s = 15; case 15: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					return [gotOnline, hostHealthy];
				/* } */ case 14:
				if (!(params$1 === false)) {
					timer$1.Stop();
					/* break; */ $s = 12; continue;
				}
				/* */ if (!connected) { $s = 16; continue; }
				/* */ $s = 17; continue;
				/* if (!connected) { */ case 16:
					$r = s.log(new sliceType$1([new $String("disconnected during session creation:"), ws.err])); /* */ $s = 18; case 18: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					timer$1.Stop();
					return [gotOnline, hostHealthy];
				/* } */ case 17:
				_r = $select([[ws.notify], [timer$1.C]]); /* */ $s = 19; case 19: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				_selection = _r;
				/* */ if (_selection[0] === 0) { $s = 20; continue; }
				/* */ if (_selection[0] === 1) { $s = 21; continue; }
				/* */ $s = 22; continue;
				/* if (_selection[0] === 0) { */ case 20:
					_tuple$1 = _selection[1];
					connected = _tuple$1[1];
					$s = 22; continue;
				/* } else if (_selection[0] === 1) { */ case 21:
					$r = s.log(new sliceType$1([new $String("session creation timeout")])); /* */ $s = 23; case 23: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					return [gotOnline, hostHealthy];
				/* } */ case 22:
			/* } */ $s = 11; continue; case 12:
			_r$1 = s.handleSessionEvent(params$1); /* */ $s = 26; case 26: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			/* */ if (!_r$1) { $s = 24; continue; }
			/* */ $s = 25; continue;
			/* if (!_r$1) { */ case 24:
				return [gotOnline, hostHealthy];
			/* } */ case 25:
			gotOnline = true;
			hostHealthy = true;
			$r = s.connActive(); /* */ $s = 27; case 27: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 10:
		fail = new $Chan(structType, 1);
		done = new $Chan(structType, 0);
		$go(webSocketSend, [s, ws, fail, done]);
		_r$2 = webSocketReceive(s, ws, fail); /* */ $s = 28; case 28: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		_tuple$2 = _r$2;
		gotEvents = _tuple$2[0];
		hostHealthy = _tuple$2[1];
		if (gotEvents) {
			gotOnline = true;
		}
		_r$3 = $recv(done); /* */ $s = 29; case 29: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
		_r$3[0];
		return [gotOnline, hostHealthy];
		/* */ } return; } if ($f === undefined) { $f = { $blk: webSocketHandshake }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._selection = _selection; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f._tuple$2 = _tuple$2; $f.connected = connected; $f.done = done; $f.err = err; $f.err$1 = err$1; $f.fail = fail; $f.gotEvents = gotEvents; $f.gotOnline = gotOnline; $f.hostHealthy = hostHealthy; $f.params = params; $f.params$1 = params$1; $f.s = s; $f.timer$1 = timer$1; $f.ws = ws; $f.$s = $s; $f.$r = $r; return $f;
	};
	webSocketSend = function(s, ws, fail, done) {
		var $ptr, _key, _key$1, _r, _selection, _tuple, action, action$1, closeSession, done, err, err$1, err$2, err$3, err$4, fail, keeper, s, sending, ws, x, x$1, x$2, x$3, x$4, x$5, x$6, $s, $deferred, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _key = $f._key; _key$1 = $f._key$1; _r = $f._r; _selection = $f._selection; _tuple = $f._tuple; action = $f.action; action$1 = $f.action$1; closeSession = $f.closeSession; done = $f.done; err = $f.err; err$1 = $f.err$1; err$2 = $f.err$2; err$3 = $f.err$3; err$4 = $f.err$4; fail = $f.fail; keeper = $f.keeper; s = $f.s; sending = $f.sending; ws = $f.ws; x = $f.x; x$1 = $f.x$1; x$2 = $f.x$2; x$3 = $f.x$3; x$4 = $f.x$4; x$5 = $f.x$5; x$6 = $f.x$6; $s = $f.$s; $deferred = $f.$deferred; $r = $f.$r; } var $err = null; try { s: while (true) { switch ($s) { case 0: $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		done = [done];
		$deferred.push([(function(done) { return function $b() {
			var $ptr, $s, $r;
			/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
			$r = $send(done[0], new structType.ptr()); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f.$s = $s; $f.$r = $r; return $f;
		}; })(done), []]);
		keeper = newTimer(jitterDuration(new duration(0, 56000), -0.3));
		$deferred.push([$methodVal(keeper, "Stop"), []]);
		s.numSent = 0;
		/* while (true) { */ case 1:
			/* while (true) { */ case 3:
				/* if (!(s.numSent < s.sendBuffer.$length)) { break; } */ if(!(s.numSent < s.sendBuffer.$length)) { $s = 4; continue; }
				action = (x = s.sendBuffer, x$1 = s.numSent, ((x$1 < 0 || x$1 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + x$1]));
				if (!(action.Payload === sliceType$2.nil)) {
					_key = "frames"; (action.Params || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key)] = { k: _key, v: new $Int(action.Payload.$length) };
				}
				if (!((x$2 = s.receivedEventId, x$3 = s.ackedEventId, (x$2.$high === x$3.$high && x$2.$low === x$3.$low)))) {
					_key$1 = "event_id"; (action.Params || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key$1)] = { k: _key$1, v: s.receivedEventId };
					s.sendEventAck = false;
					s.ackedEventId = s.receivedEventId;
				}
				err = ws.sendJSON(action.Params);
				delete action.Params[$String.keyFor("frames")];
				delete action.Params[$String.keyFor("event_id")];
				/* */ if (!($interfaceIsEqual(err, $ifaceNil))) { $s = 5; continue; }
				/* */ $s = 6; continue;
				/* if (!($interfaceIsEqual(err, $ifaceNil))) { */ case 5:
					$r = s.log(new sliceType$1([new $String("send:"), err])); /* */ $s = 7; case 7: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					$r = $send(fail, new structType.ptr()); /* */ $s = 8; case 8: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					return;
				/* } */ case 6:
				/* */ if (!(action.Payload === sliceType$2.nil)) { $s = 9; continue; }
				/* */ $s = 10; continue;
				/* if (!(action.Payload === sliceType$2.nil)) { */ case 9:
					err$1 = ws.sendPayload(action);
					/* */ if (!($interfaceIsEqual(err$1, $ifaceNil))) { $s = 11; continue; }
					/* */ $s = 12; continue;
					/* if (!($interfaceIsEqual(err$1, $ifaceNil))) { */ case 11:
						$r = s.log(new sliceType$1([new $String("send:"), err$1])); /* */ $s = 13; case 13: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
						$r = $send(fail, new structType.ptr()); /* */ $s = 14; case 14: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
						return;
					/* } */ case 12:
				/* } */ case 10:
				if ((x$4 = action.id, (x$4.$high === 0 && x$4.$low === 0))) {
					s.sendBuffer = $appendSlice($subslice(s.sendBuffer, 0, s.numSent), $subslice(s.sendBuffer, (s.numSent + 1 >> 0)));
				} else {
					s.numSent = s.numSent + (1) >> 0;
				}
				keeper.Reset(jitterDuration(new duration(0, 56000), -0.3));
			/* } */ $s = 3; continue; case 4:
			/* */ if (s.sendEventAck && !((x$5 = s.receivedEventId, x$6 = s.ackedEventId, (x$5.$high === x$6.$high && x$5.$low === x$6.$low)))) { $s = 15; continue; }
			/* */ $s = 16; continue;
			/* if (s.sendEventAck && !((x$5 = s.receivedEventId, x$6 = s.ackedEventId, (x$5.$high === x$6.$high && x$5.$low === x$6.$low)))) { */ case 15:
				action$1 = s.makeResumeSessionAction(false);
				err$2 = ws.sendJSON(action$1);
				/* */ if (!($interfaceIsEqual(err$2, $ifaceNil))) { $s = 17; continue; }
				/* */ $s = 18; continue;
				/* if (!($interfaceIsEqual(err$2, $ifaceNil))) { */ case 17:
					$r = s.log(new sliceType$1([new $String("send:"), err$2])); /* */ $s = 19; case 19: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					$r = $send(fail, new structType.ptr()); /* */ $s = 20; case 20: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					return;
				/* } */ case 18:
			/* } */ case 16:
			_r = $select([[s.sendNotify], [keeper.C], [fail]]); /* */ $s = 21; case 21: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			_selection = _r;
			/* */ if (_selection[0] === 0) { $s = 22; continue; }
			/* */ if (_selection[0] === 1) { $s = 23; continue; }
			/* */ if (_selection[0] === 2) { $s = 24; continue; }
			/* */ $s = 25; continue;
			/* if (_selection[0] === 0) { */ case 22:
				_tuple = _selection[1];
				sending = _tuple[1];
				/* */ if (!sending) { $s = 26; continue; }
				/* */ $s = 27; continue;
				/* if (!sending) { */ case 26:
					closeSession = $makeMap($String.keyFor, [{ k: "action", v: new $String("close_session") }]);
					err$3 = ws.sendJSON(closeSession);
					/* */ if (!($interfaceIsEqual(err$3, $ifaceNil))) { $s = 28; continue; }
					/* */ $s = 29; continue;
					/* if (!($interfaceIsEqual(err$3, $ifaceNil))) { */ case 28:
						$r = s.log(new sliceType$1([new $String("send:"), err$3])); /* */ $s = 30; case 30: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					/* } */ case 29:
					return;
				/* } */ case 27:
				$s = 25; continue;
			/* } else if (_selection[0] === 1) { */ case 23:
				err$4 = ws.send(emptyData());
				/* */ if (!($interfaceIsEqual(err$4, $ifaceNil))) { $s = 31; continue; }
				/* */ $s = 32; continue;
				/* if (!($interfaceIsEqual(err$4, $ifaceNil))) { */ case 31:
					$r = s.log(new sliceType$1([new $String("send:"), err$4])); /* */ $s = 33; case 33: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					$r = $send(fail, new structType.ptr()); /* */ $s = 34; case 34: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					return;
				/* } */ case 32:
				keeper.Reset(jitterDuration(new duration(0, 56000), -0.3));
				$s = 25; continue;
			/* } else if (_selection[0] === 2) { */ case 24:
				return;
			/* } */ case 25:
		/* } */ $s = 1; continue; case 2:
		/* */ $s = -1; case -1: } return; } } catch(err) { $err = err; $s = -1; } finally { $callDeferred($deferred, $err); if($curGoroutine.asleep) { if ($f === undefined) { $f = { $blk: webSocketSend }; } $f.$ptr = $ptr; $f._key = _key; $f._key$1 = _key$1; $f._r = _r; $f._selection = _selection; $f._tuple = _tuple; $f.action = action; $f.action$1 = action$1; $f.closeSession = closeSession; $f.done = done; $f.err = err; $f.err$1 = err$1; $f.err$2 = err$2; $f.err$3 = err$3; $f.err$4 = err$4; $f.fail = fail; $f.keeper = keeper; $f.s = s; $f.sending = sending; $f.ws = ws; $f.x = x; $f.x$1 = x$1; $f.x$2 = x$2; $f.x$3 = x$3; $f.x$4 = x$4; $f.x$5 = x$5; $f.x$6 = x$6; $f.$s = $s; $f.$deferred = $deferred; $f.$r = $r; return $f; } }
	};
	webSocketReceive = function(s, ws, fail) {
		var $ptr, _r, _r$1, _selection, _selection$1, _tuple, _tuple$1, _tuple$2, ackNeeded, acker, connected, data, data$1, err, event, fail, frames, gotEvents, hostHealthy, n, needsAck, ok, params, s, sessionLost, text, watchdog, ws, x, x$1, $s, $deferred, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _selection = $f._selection; _selection$1 = $f._selection$1; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; _tuple$2 = $f._tuple$2; ackNeeded = $f.ackNeeded; acker = $f.acker; connected = $f.connected; data = $f.data; data$1 = $f.data$1; err = $f.err; event = $f.event; fail = $f.fail; frames = $f.frames; gotEvents = $f.gotEvents; hostHealthy = $f.hostHealthy; n = $f.n; needsAck = $f.needsAck; ok = $f.ok; params = $f.params; s = $f.s; sessionLost = $f.sessionLost; text = $f.text; watchdog = $f.watchdog; ws = $f.ws; x = $f.x; x$1 = $f.x$1; $s = $f.$s; $deferred = $f.$deferred; $r = $f.$r; } var $err = null; try { s: while (true) { switch ($s) { case 0: $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		gotEvents = false;
		hostHealthy = false;
		event = ptrType.nil;
		frames = 0;
		watchdog = newTimer(jitterDuration(new duration(0, 64000), 0.3));
		$deferred.push([$methodVal(watchdog, "Stop"), []]);
		acker = newTimer(new duration(-1, 4294967295));
		$deferred.push([$methodVal(acker, "Stop"), []]);
		/* while (true) { */ case 1:
			ackNeeded = false;
			/* while (true) { */ case 3:
				params = [params];
				/* */ if (event === ptrType.nil) { $s = 5; continue; }
				/* */ $s = 6; continue;
				/* if (event === ptrType.nil) { */ case 5:
					data = ws.receive();
					if (data === null) {
						/* break; */ $s = 4; continue;
					}
					watchdog.Reset(jitterDuration(new duration(0, 64000), 0.7));
					$r = s.connActive(); /* */ $s = 8; case 8: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					text = stringData(data);
					/* */ if (dataLength(text) === 0) { $s = 9; continue; }
					/* */ $s = 10; continue;
					/* if (dataLength(text) === 0) { */ case 9:
						/* continue; */ $s = 3; continue;
					/* } */ case 10:
					params[0] = false;
					err = jsonUnmarshalObject(text, (params.$ptr || (params.$ptr = new ptrType$2(function() { return this.$target[0]; }, function($v) { this.$target[0] = $v; }, params))));
					/* */ if (!($interfaceIsEqual(err, $ifaceNil))) { $s = 11; continue; }
					/* */ $s = 12; continue;
					/* if (!($interfaceIsEqual(err, $ifaceNil))) { */ case 11:
						$r = s.log(new sliceType$1([new $String("receive:"), err])); /* */ $s = 13; case 13: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
						hostHealthy = false;
						$r = $send(fail, new structType.ptr()); /* */ $s = 14; case 14: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
						return [gotEvents, hostHealthy];
					/* } */ case 12:
					event = new Event.ptr(params[0], sliceType$2.nil, false);
					_tuple = event.Int("frames");
					n = _tuple[0];
					if (n > 0) {
						frames = n;
					}
					$s = 7; continue;
				/* } else { */ case 6:
					data$1 = ws.receive();
					if (data$1 === null) {
						/* break; */ $s = 4; continue;
					}
					event.Payload = $append(event.Payload, data$1);
					frames = frames - (1) >> 0;
				/* } */ case 7:
				/* */ if (frames === 0) { $s = 15; continue; }
				/* */ $s = 16; continue;
				/* if (frames === 0) { */ case 15:
					_r = s.handleEvent(event); /* */ $s = 17; case 17: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
					_tuple$1 = _r;
					sessionLost = _tuple$1[1];
					needsAck = _tuple$1[2];
					ok = _tuple$1[3];
					/* */ if (!ok) { $s = 18; continue; }
					/* */ $s = 19; continue;
					/* if (!ok) { */ case 18:
						if (sessionLost) {
							gotEvents = true;
						} else {
							hostHealthy = false;
						}
						$r = $send(fail, new structType.ptr()); /* */ $s = 20; case 20: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
						return [gotEvents, hostHealthy];
					/* } */ case 19:
					if (needsAck) {
						ackNeeded = true;
					}
					event = ptrType.nil;
					frames = 0;
					gotEvents = true;
					hostHealthy = true;
				/* } */ case 16:
				_selection = $select([[s.closeNotify], [fail], []]);
				if (_selection[0] === 0) {
					return [gotEvents, hostHealthy];
				} else if (_selection[0] === 1) {
					return [gotEvents, hostHealthy];
				} else if (_selection[0] === 2) {
				}
			/* } */ $s = 3; continue; case 4:
			if (ackNeeded && !acker.Active()) {
				acker.Reset(jitterDuration(new duration(0, 7000), -0.3));
			}
			_r$1 = $select([[ws.notify], [watchdog.C], [acker.C], [s.closeNotify], [fail]]); /* */ $s = 21; case 21: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			_selection$1 = _r$1;
			/* */ if (_selection$1[0] === 0) { $s = 22; continue; }
			/* */ if (_selection$1[0] === 1) { $s = 23; continue; }
			/* */ if (_selection$1[0] === 2) { $s = 24; continue; }
			/* */ if (_selection$1[0] === 3) { $s = 25; continue; }
			/* */ if (_selection$1[0] === 4) { $s = 26; continue; }
			/* */ $s = 27; continue;
			/* if (_selection$1[0] === 0) { */ case 22:
				_tuple$2 = _selection$1[1];
				connected = _tuple$2[1];
				/* */ if (!connected) { $s = 28; continue; }
				/* */ $s = 29; continue;
				/* if (!connected) { */ case 28:
					$r = s.log(new sliceType$1([new $String("receive:"), ws.err])); /* */ $s = 30; case 30: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					$r = $send(fail, new structType.ptr()); /* */ $s = 31; case 31: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					return [gotEvents, hostHealthy];
				/* } */ case 29:
				$s = 27; continue;
			/* } else if (_selection$1[0] === 1) { */ case 23:
				$r = s.log(new sliceType$1([new $String("receive timeout")])); /* */ $s = 32; case 32: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				$r = $send(fail, new structType.ptr()); /* */ $s = 33; case 33: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				return [gotEvents, hostHealthy];
			/* } else if (_selection$1[0] === 2) { */ case 24:
				if (!s.sendEventAck && !((x = s.ackedEventId, x$1 = s.receivedEventId, (x.$high === x$1.$high && x.$low === x$1.$low)))) {
					s.sendAck();
				}
				$s = 27; continue;
			/* } else if (_selection$1[0] === 3) { */ case 25:
				return [gotEvents, hostHealthy];
			/* } else if (_selection$1[0] === 4) { */ case 26:
				return [gotEvents, hostHealthy];
			/* } */ case 27:
		/* } */ $s = 1; continue; case 2:
		/* */ $s = -1; case -1: } return; } } catch(err) { $err = err; $s = -1; } finally { $callDeferred($deferred, $err); if (!$curGoroutine.asleep) { return  [gotEvents, hostHealthy]; } if($curGoroutine.asleep) { if ($f === undefined) { $f = { $blk: webSocketReceive }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._selection = _selection; $f._selection$1 = _selection$1; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f._tuple$2 = _tuple$2; $f.ackNeeded = ackNeeded; $f.acker = acker; $f.connected = connected; $f.data = data; $f.data$1 = data$1; $f.err = err; $f.event = event; $f.fail = fail; $f.frames = frames; $f.gotEvents = gotEvents; $f.hostHealthy = hostHealthy; $f.n = n; $f.needsAck = needsAck; $f.ok = ok; $f.params = params; $f.s = s; $f.sessionLost = sessionLost; $f.text = text; $f.watchdog = watchdog; $f.ws = ws; $f.x = x; $f.x$1 = x$1; $f.$s = $s; $f.$deferred = $deferred; $f.$r = $r; return $f; } }
	};
	ptrType$6.methods = [{prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType.methods = [{prop: "Bool", name: "Bool", pkg: "", typ: $funcType([$String], [$Bool], false)}, {prop: "Int", name: "Int", pkg: "", typ: $funcType([$String], [$Int, $Bool], false)}, {prop: "Int64", name: "Int64", pkg: "", typ: $funcType([$String], [$Int64, $Bool], false)}, {prop: "Float64", name: "Float64", pkg: "", typ: $funcType([$String], [$Float64, $Bool], false)}, {prop: "Str", name: "Str", pkg: "", typ: $funcType([$String], [$String, $Bool], false)}, {prop: "Array", name: "Array", pkg: "", typ: $funcType([$String], [sliceType$1, $Bool], false)}, {prop: "Map", name: "Map", pkg: "", typ: $funcType([$String], [mapType, $Bool], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}, {prop: "initLastReply", name: "initLastReply", pkg: "github.com/ninchat/ninchat-go", typ: $funcType([ptrType$6], [], false)}, {prop: "getError", name: "getError", pkg: "github.com/ninchat/ninchat-go", typ: $funcType([], [$String, $String, $Bool, $error], false)}];
	ptrType$9.methods = [{prop: "success", name: "success", pkg: "github.com/ninchat/ninchat-go", typ: $funcType([], [], false)}, {prop: "failure", name: "failure", pkg: "github.com/ninchat/ninchat-go", typ: $funcType([duration], [duration], false)}];
	ptrType$10.methods = [{prop: "Call", name: "Call", pkg: "", typ: $funcType([ptrType$6], [sliceType$3, $error], false)}];
	httpHeader.methods = [{prop: "Set", name: "Set", pkg: "", typ: $funcType([$String, $String], [], false)}];
	ptrType$11.methods = [{prop: "SetParams", name: "SetParams", pkg: "", typ: $funcType([mapType], [], false)}, {prop: "SetTransport", name: "SetTransport", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Open", name: "Open", pkg: "", typ: $funcType([], [], false)}, {prop: "Close", name: "Close", pkg: "", typ: $funcType([], [], false)}, {prop: "Send", name: "Send", pkg: "", typ: $funcType([ptrType$6], [], false)}, {prop: "send", name: "send", pkg: "github.com/ninchat/ninchat-go", typ: $funcType([ptrType$6], [], false)}, {prop: "sendAck", name: "sendAck", pkg: "github.com/ninchat/ninchat-go", typ: $funcType([], [], false)}, {prop: "discover", name: "discover", pkg: "github.com/ninchat/ninchat-go", typ: $funcType([], [], false)}, {prop: "connect", name: "connect", pkg: "github.com/ninchat/ninchat-go", typ: $funcType([transport, sliceType, ptrType$9], [$Bool], false)}, {prop: "backOff", name: "backOff", pkg: "github.com/ninchat/ninchat-go", typ: $funcType([ptrType$9], [$Bool], false)}, {prop: "canLogin", name: "canLogin", pkg: "github.com/ninchat/ninchat-go", typ: $funcType([], [$Bool], false)}, {prop: "makeCreateSessionAction", name: "makeCreateSessionAction", pkg: "github.com/ninchat/ninchat-go", typ: $funcType([], [mapType], false)}, {prop: "makeResumeSessionAction", name: "makeResumeSessionAction", pkg: "github.com/ninchat/ninchat-go", typ: $funcType([$Bool], [mapType], false)}, {prop: "handleSessionEvent", name: "handleSessionEvent", pkg: "github.com/ninchat/ninchat-go", typ: $funcType([mapType], [$Bool], false)}, {prop: "handleEvent", name: "handleEvent", pkg: "github.com/ninchat/ninchat-go", typ: $funcType([ptrType], [$Int64, $Bool, $Bool, $Bool], false)}, {prop: "connState", name: "connState", pkg: "github.com/ninchat/ninchat-go", typ: $funcType([$String], [], false)}, {prop: "connActive", name: "connActive", pkg: "github.com/ninchat/ninchat-go", typ: $funcType([], [], false)}, {prop: "log", name: "log", pkg: "github.com/ninchat/ninchat-go", typ: $funcType([sliceType$1], [], true)}];
	ptrType$7.methods = [{prop: "Active", name: "Active", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "Reset", name: "Reset", pkg: "", typ: $funcType([duration], [], false)}, {prop: "Stop", name: "Stop", pkg: "", typ: $funcType([], [], false)}];
	ptrType$8.methods = [{prop: "send", name: "send", pkg: "github.com/ninchat/ninchat-go", typ: $funcType([ptrType$4], [$error], false)}, {prop: "sendJSON", name: "sendJSON", pkg: "github.com/ninchat/ninchat-go", typ: $funcType([mapType], [$error], false)}, {prop: "sendPayload", name: "sendPayload", pkg: "github.com/ninchat/ninchat-go", typ: $funcType([ptrType$6], [$error], false)}, {prop: "receive", name: "receive", pkg: "github.com/ninchat/ninchat-go", typ: $funcType([], [ptrType$4], false)}, {prop: "receiveJSON", name: "receiveJSON", pkg: "github.com/ninchat/ninchat-go", typ: $funcType([], [mapType, $error], false)}, {prop: "close", name: "close", pkg: "github.com/ninchat/ninchat-go", typ: $funcType([], [], false)}];
	Action.init([{prop: "Params", name: "Params", pkg: "", typ: mapType, tag: ""}, {prop: "Payload", name: "Payload", pkg: "", typ: sliceType$2, tag: ""}, {prop: "OnReply", name: "OnReply", pkg: "", typ: funcType$2, tag: ""}, {prop: "id", name: "id", pkg: "github.com/ninchat/ninchat-go", typ: $Int64, tag: ""}]);
	Event.init([{prop: "Params", name: "Params", pkg: "", typ: mapType, tag: ""}, {prop: "Payload", name: "Payload", pkg: "", typ: sliceType$2, tag: ""}, {prop: "LastReply", name: "LastReply", pkg: "", typ: $Bool, tag: ""}]);
	Frame.init(js.Object);
	backoff.init([{prop: "lastSlot", name: "lastSlot", pkg: "github.com/ninchat/ninchat-go", typ: $Int, tag: ""}]);
	Caller.init([{prop: "Address", name: "Address", pkg: "", typ: $String, tag: ""}]);
	httpHeader.init($String, $String);
	httpRequest.init([{prop: "Method", name: "Method", pkg: "", typ: $String, tag: ""}, {prop: "URL", name: "URL", pkg: "", typ: $String, tag: ""}, {prop: "Header", name: "Header", pkg: "", typ: httpHeader, tag: ""}, {prop: "data", name: "data", pkg: "github.com/ninchat/ninchat-go", typ: ptrType$4, tag: ""}]);
	httpResponse.init([{prop: "data", name: "data", pkg: "github.com/ninchat/ninchat-go", typ: ptrType$4, tag: ""}, {prop: "err", name: "err", pkg: "github.com/ninchat/ninchat-go", typ: $error, tag: ""}]);
	Session.init([{prop: "OnSessionEvent", name: "OnSessionEvent", pkg: "", typ: funcType$2, tag: ""}, {prop: "OnEvent", name: "OnEvent", pkg: "", typ: funcType$2, tag: ""}, {prop: "OnClose", name: "OnClose", pkg: "", typ: funcType, tag: ""}, {prop: "OnConnState", name: "OnConnState", pkg: "", typ: funcType$3, tag: ""}, {prop: "OnConnActive", name: "OnConnActive", pkg: "", typ: funcType, tag: ""}, {prop: "OnLog", name: "OnLog", pkg: "", typ: funcType$4, tag: ""}, {prop: "Address", name: "Address", pkg: "", typ: $String, tag: ""}, {prop: "forceLongPoll", name: "forceLongPoll", pkg: "github.com/ninchat/ninchat-go", typ: $Bool, tag: ""}, {prop: "sessionParams", name: "sessionParams", pkg: "github.com/ninchat/ninchat-go", typ: mapType, tag: ""}, {prop: "sessionId", name: "sessionId", pkg: "github.com/ninchat/ninchat-go", typ: $emptyInterface, tag: ""}, {prop: "latestConnState", name: "latestConnState", pkg: "github.com/ninchat/ninchat-go", typ: $String, tag: ""}, {prop: "lastActionId", name: "lastActionId", pkg: "github.com/ninchat/ninchat-go", typ: $Int64, tag: ""}, {prop: "sendNotify", name: "sendNotify", pkg: "github.com/ninchat/ninchat-go", typ: chanType, tag: ""}, {prop: "sendBuffer", name: "sendBuffer", pkg: "github.com/ninchat/ninchat-go", typ: sliceType$5, tag: ""}, {prop: "numSent", name: "numSent", pkg: "github.com/ninchat/ninchat-go", typ: $Int, tag: ""}, {prop: "sendEventAck", name: "sendEventAck", pkg: "github.com/ninchat/ninchat-go", typ: $Bool, tag: ""}, {prop: "receivedEventId", name: "receivedEventId", pkg: "github.com/ninchat/ninchat-go", typ: $Int64, tag: ""}, {prop: "ackedEventId", name: "ackedEventId", pkg: "github.com/ninchat/ninchat-go", typ: $Int64, tag: ""}, {prop: "closeNotify", name: "closeNotify", pkg: "github.com/ninchat/ninchat-go", typ: chanType, tag: ""}, {prop: "closed", name: "closed", pkg: "github.com/ninchat/ninchat-go", typ: $Bool, tag: ""}, {prop: "running", name: "running", pkg: "github.com/ninchat/ninchat-go", typ: $Bool, tag: ""}]);
	transport.init([ptrType$11, $String], [$Bool, $Bool], false);
	timer.init([{prop: "C", name: "C", pkg: "", typ: chanType, tag: ""}, {prop: "id", name: "id", pkg: "github.com/ninchat/ninchat-go", typ: ptrType$4, tag: ""}]);
	webSocket.init([{prop: "notify", name: "notify", pkg: "github.com/ninchat/ninchat-go", typ: chanType, tag: ""}, {prop: "goingAway", name: "goingAway", pkg: "github.com/ninchat/ninchat-go", typ: $Bool, tag: ""}, {prop: "err", name: "err", pkg: "github.com/ninchat/ninchat-go", typ: $error, tag: ""}, {prop: "impl", name: "impl", pkg: "github.com/ninchat/ninchat-go", typ: ptrType$4, tag: ""}, {prop: "open", name: "open", pkg: "github.com/ninchat/ninchat-go", typ: $Bool, tag: ""}, {prop: "buf", name: "buf", pkg: "github.com/ninchat/ninchat-go", typ: sliceType$6, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = errors.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = js.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = sort.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		defaultCaller = new Caller.ptr("");
		xhrType = null;
		xhrRequestHeaderSupport = false;
		webSocketSupported = false;
		sessionEventAckWindow = jitterInt64(new $Int64(0, 4096), -0.25);
		init();
		init$1();
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["github.com/ninchat/ninchat-go/ninchatapi"] = (function() {
	var $pkg = {}, $init, ninchat, DescribeUser, DiscardHistory, LoadHistory, UpdateDialogue, UserInfoAttr, RealmOwnerAccountAttr, RealmThemeAttr, ChannelAttrs, ChannelMemberAttrs, DialogueMemberAttrs, IdentityAttrs, PuppetAttrs, QueueAttrs, QueueMemberAttrs, RealmAttrs, RealmMemberAttrs, UserAttrs, UnexpectedEventError, AccessCreated, AccessFound, AudienceEnqueued, ChannelDeleted, ChannelFound, ChannelJoined, ChannelMemberJoined, ChannelMemberParted, ChannelMemberUpdated, ChannelParted, ChannelUpdated, DialogueUpdated, Error, HistoryDiscarded, HistoryResults, IdentityCreated, IdentityDeleted, IdentityFound, IdentityUpdated, MasterKeyCreated, MasterKeyDeleted, MasterKeysFound, MessageReceived, MessageUpdated, Pong, QueueCreated, QueueDeleted, QueueFound, QueueJoined, QueueMemberJoined, QueueMemberParted, QueueParted, QueueTranscriptsDeleted, QueueTranscriptsFound, QueueUpdated, RealmDeleted, RealmFound, RealmJoined, RealmMemberJoined, RealmMemberParted, RealmMemberUpdated, RealmParted, RealmQueuesFound, RealmUpdated, SearchResults, SessionCreated, SessionStatusUpdated, TranscriptContents, TranscriptDeleted, UserDeleted, UserFound, UserUpdated, ChannelMember, ChannelResult, PuppetMaster, QueueMember, QueueTranscript, RealmMember, RealmQueue, TranscriptMessage, UserAccount, UserAccountExtent, UserAccountMembers, UserAccountObjects, UserAccountSubscription, UserChannel, UserDialogue, UserQueue, UserResult, ptrType, ptrType$1, ptrType$2, ptrType$3, ptrType$4, ptrType$5, ptrType$6, ptrType$7, ptrType$8, sliceType, ptrType$9, sliceType$1, ptrType$10, ptrType$11, sliceType$2, ptrType$12, ptrType$13, ptrType$14, sliceType$3, ptrType$15, ptrType$16, ptrType$17, ptrType$18, ptrType$20, ptrType$21, ptrType$22, ptrType$23, ptrType$24, ptrType$25, ptrType$26, ptrType$27, ptrType$28, ptrType$29, ptrType$30, ptrType$31, ptrType$32, ptrType$33, ptrType$34, ptrType$35, ptrType$36, ptrType$37, ptrType$38, ptrType$39, ptrType$40, ptrType$41, ptrType$42, ptrType$43, ptrType$44, ptrType$45, ptrType$46, ptrType$47, ptrType$48, ptrType$49, ptrType$51, ptrType$52, ptrType$53, mapType, ptrType$54, ptrType$55, ptrType$56, ptrType$57, ptrType$58, ptrType$60, ptrType$61, ptrType$62, ptrType$63, ptrType$64, ptrType$65, ptrType$66, ptrType$67, ptrType$68, ptrType$69, ptrType$70, sliceType$4, ptrType$71, ptrType$72, ptrType$73, ptrType$74, ptrType$75, ptrType$76, ptrType$77, ptrType$78, ptrType$79, ptrType$80, structType, ptrType$81, ptrType$82, ptrType$83, ptrType$84, ptrType$85, sliceType$5, ptrType$86, ptrType$87, ptrType$88, ptrType$89, ptrType$90, ptrType$115, ptrType$116, ptrType$120, ptrType$133, ptrType$144, mapType$1, mapType$2, mapType$3, mapType$4, mapType$5, mapType$6, mapType$7, mapType$8, mapType$9, mapType$10, mapType$11, mapType$12, mapType$13, mapType$14, mapType$15, mapType$16, mapType$17, Call, Send, unaryCall, flush, NewUserInfoAttr, NewRealmOwnerAccountAttr, NewRealmThemeAttr, NewChannelAttrs, NewChannelMemberAttrs, NewDialogueMemberAttrs, NewIdentityAttrs, NewPuppetAttrs, NewQueueAttrs, NewQueueMemberAttrs, NewRealmAttrs, NewRealmMemberAttrs, NewUserAttrs, newRequestMalformedError, NewEvent, NewError, AppendStrings, intPointer, NewChannelMember, MakeChannelMembers, NewChannelResult, MakeChannels, MakeDialogueMembers, MakeMasterKeys, NewPuppetMaster, MakePuppetMasters, NewQueueMember, MakeQueueMembers, NewQueueTranscript, AppendQueueTranscripts, NewRealmMember, MakeRealmMembers, NewRealmQueue, MakeRealmQueues, NewTranscriptMessage, AppendTranscriptMessages, NewUserAccount, NewUserAccountExtent, NewUserAccountMembers, NewUserAccountObjects, NewUserAccountSubscription, AppendUserAccountSubscriptions, NewUserChannel, MakeUserChannels, NewUserDialogue, MakeUserDialogues, MakeUserIdentities, NewUserQueue, MakeUserQueues, MakeUserRealms, MakeUserRealmsMember, NewUserResult, MakeUsers;
	ninchat = $packages["github.com/ninchat/ninchat-go"];
	DescribeUser = $pkg.DescribeUser = $newType(0, $kindStruct, "ninchatapi.DescribeUser", "DescribeUser", "github.com/ninchat/ninchat-go/ninchatapi", function(UserId_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.UserId = ptrType.nil;
			return;
		}
		this.UserId = UserId_;
	});
	DiscardHistory = $pkg.DiscardHistory = $newType(0, $kindStruct, "ninchatapi.DiscardHistory", "DiscardHistory", "github.com/ninchat/ninchat-go/ninchatapi", function(MessageId_, UserId_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.MessageId = ptrType.nil;
			this.UserId = ptrType.nil;
			return;
		}
		this.MessageId = MessageId_;
		this.UserId = UserId_;
	});
	LoadHistory = $pkg.LoadHistory = $newType(0, $kindStruct, "ninchatapi.LoadHistory", "LoadHistory", "github.com/ninchat/ninchat-go/ninchatapi", function(ChannelId_, FilterProperty_, FilterSubstring_, HistoryLength_, HistoryOrder_, MessageId_, MessageTypes_, UserId_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.ChannelId = ptrType.nil;
			this.FilterProperty = ptrType.nil;
			this.FilterSubstring = ptrType.nil;
			this.HistoryLength = ptrType$8.nil;
			this.HistoryOrder = ptrType$8.nil;
			this.MessageId = ptrType.nil;
			this.MessageTypes = sliceType.nil;
			this.UserId = ptrType.nil;
			return;
		}
		this.ChannelId = ChannelId_;
		this.FilterProperty = FilterProperty_;
		this.FilterSubstring = FilterSubstring_;
		this.HistoryLength = HistoryLength_;
		this.HistoryOrder = HistoryOrder_;
		this.MessageId = MessageId_;
		this.MessageTypes = MessageTypes_;
		this.UserId = UserId_;
	});
	UpdateDialogue = $pkg.UpdateDialogue = $newType(0, $kindStruct, "ninchatapi.UpdateDialogue", "UpdateDialogue", "github.com/ninchat/ninchat-go/ninchatapi", function(DialogueStatus_, MemberAttrs_, UserId_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.DialogueStatus = ptrType.nil;
			this.MemberAttrs = ptrType$58.nil;
			this.UserId = ptrType.nil;
			return;
		}
		this.DialogueStatus = DialogueStatus_;
		this.MemberAttrs = MemberAttrs_;
		this.UserId = UserId_;
	});
	UserInfoAttr = $pkg.UserInfoAttr = $newType(0, $kindStruct, "ninchatapi.UserInfoAttr", "UserInfoAttr", "github.com/ninchat/ninchat-go/ninchatapi", function(Company_, Url_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Company = ptrType.nil;
			this.Url = ptrType.nil;
			return;
		}
		this.Company = Company_;
		this.Url = Url_;
	});
	RealmOwnerAccountAttr = $pkg.RealmOwnerAccountAttr = $newType(0, $kindStruct, "ninchatapi.RealmOwnerAccountAttr", "RealmOwnerAccountAttr", "github.com/ninchat/ninchat-go/ninchatapi", function(Channels_, QueueMembers_, Queues_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Channels = ptrType$68.nil;
			this.QueueMembers = ptrType$69.nil;
			this.Queues = ptrType$68.nil;
			return;
		}
		this.Channels = Channels_;
		this.QueueMembers = QueueMembers_;
		this.Queues = Queues_;
	});
	RealmThemeAttr = $pkg.RealmThemeAttr = $newType(0, $kindStruct, "ninchatapi.RealmThemeAttr", "RealmThemeAttr", "github.com/ninchat/ninchat-go/ninchatapi", function(Color_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Color = ptrType.nil;
			return;
		}
		this.Color = Color_;
	});
	ChannelAttrs = $pkg.ChannelAttrs = $newType(0, $kindStruct, "ninchatapi.ChannelAttrs", "ChannelAttrs", "github.com/ninchat/ninchat-go/ninchatapi", function(Autohide_, Autosilence_, BlacklistedMessageTypes_, Closed_, DisclosedSince_, Followable_, Name_, OwnerId_, Private_, Public_, Ratelimit_, Suspended_, Topic_, Upload_, VerifiedJoin_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Autohide = false;
			this.Autosilence = false;
			this.BlacklistedMessageTypes = sliceType.nil;
			this.Closed = false;
			this.DisclosedSince = ptrType$8.nil;
			this.Followable = false;
			this.Name = ptrType.nil;
			this.OwnerId = ptrType.nil;
			this.Private = false;
			this.Public = false;
			this.Ratelimit = ptrType.nil;
			this.Suspended = false;
			this.Topic = ptrType.nil;
			this.Upload = ptrType.nil;
			this.VerifiedJoin = false;
			return;
		}
		this.Autohide = Autohide_;
		this.Autosilence = Autosilence_;
		this.BlacklistedMessageTypes = BlacklistedMessageTypes_;
		this.Closed = Closed_;
		this.DisclosedSince = DisclosedSince_;
		this.Followable = Followable_;
		this.Name = Name_;
		this.OwnerId = OwnerId_;
		this.Private = Private_;
		this.Public = Public_;
		this.Ratelimit = Ratelimit_;
		this.Suspended = Suspended_;
		this.Topic = Topic_;
		this.Upload = Upload_;
		this.VerifiedJoin = VerifiedJoin_;
	});
	ChannelMemberAttrs = $pkg.ChannelMemberAttrs = $newType(0, $kindStruct, "ninchatapi.ChannelMemberAttrs", "ChannelMemberAttrs", "github.com/ninchat/ninchat-go/ninchatapi", function(Autohide_, Moderator_, Operator_, Silenced_, Since_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Autohide = false;
			this.Moderator = false;
			this.Operator = false;
			this.Silenced = false;
			this.Since = ptrType$8.nil;
			return;
		}
		this.Autohide = Autohide_;
		this.Moderator = Moderator_;
		this.Operator = Operator_;
		this.Silenced = Silenced_;
		this.Since = Since_;
	});
	DialogueMemberAttrs = $pkg.DialogueMemberAttrs = $newType(0, $kindStruct, "ninchatapi.DialogueMemberAttrs", "DialogueMemberAttrs", "github.com/ninchat/ninchat-go/ninchatapi", function(AudienceEnded_, QueueId_, Rating_, Writing_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.AudienceEnded = false;
			this.QueueId = ptrType.nil;
			this.Rating = ptrType$8.nil;
			this.Writing = false;
			return;
		}
		this.AudienceEnded = AudienceEnded_;
		this.QueueId = QueueId_;
		this.Rating = Rating_;
		this.Writing = Writing_;
	});
	IdentityAttrs = $pkg.IdentityAttrs = $newType(0, $kindStruct, "ninchatapi.IdentityAttrs", "IdentityAttrs", "github.com/ninchat/ninchat-go/ninchatapi", function(Auth_, Blocked_, Pending_, Public_, Rejected_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Auth = false;
			this.Blocked = false;
			this.Pending = false;
			this.Public = false;
			this.Rejected = false;
			return;
		}
		this.Auth = Auth_;
		this.Blocked = Blocked_;
		this.Pending = Pending_;
		this.Public = Public_;
		this.Rejected = Rejected_;
	});
	PuppetAttrs = $pkg.PuppetAttrs = $newType(0, $kindStruct, "ninchatapi.PuppetAttrs", "PuppetAttrs", "github.com/ninchat/ninchat-go/ninchatapi", function(Name_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Name = ptrType.nil;
			return;
		}
		this.Name = Name_;
	});
	QueueAttrs = $pkg.QueueAttrs = $newType(0, $kindStruct, "ninchatapi.QueueAttrs", "QueueAttrs", "github.com/ninchat/ninchat-go/ninchatapi", function(Capacity_, Closed_, Length_, Name_, Suspended_, Upload_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Capacity = ptrType$8.nil;
			this.Closed = false;
			this.Length = ptrType$8.nil;
			this.Name = ptrType.nil;
			this.Suspended = false;
			this.Upload = ptrType.nil;
			return;
		}
		this.Capacity = Capacity_;
		this.Closed = Closed_;
		this.Length = Length_;
		this.Name = Name_;
		this.Suspended = Suspended_;
		this.Upload = Upload_;
	});
	QueueMemberAttrs = $pkg.QueueMemberAttrs = $newType(0, $kindStruct, "ninchatapi.QueueMemberAttrs", "QueueMemberAttrs", "github.com/ninchat/ninchat-go/ninchatapi", function() {
		this.$val = this;
		if (arguments.length === 0) {
			return;
		}
	});
	RealmAttrs = $pkg.RealmAttrs = $newType(0, $kindStruct, "ninchatapi.RealmAttrs", "RealmAttrs", "github.com/ninchat/ninchat-go/ninchatapi", function(Name_, OwnerAccount_, OwnerId_, Suspended_, Theme_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Name = ptrType.nil;
			this.OwnerAccount = ptrType$67.nil;
			this.OwnerId = ptrType.nil;
			this.Suspended = false;
			this.Theme = ptrType$70.nil;
			return;
		}
		this.Name = Name_;
		this.OwnerAccount = OwnerAccount_;
		this.OwnerId = OwnerId_;
		this.Suspended = Suspended_;
		this.Theme = Theme_;
	});
	RealmMemberAttrs = $pkg.RealmMemberAttrs = $newType(0, $kindStruct, "ninchatapi.RealmMemberAttrs", "RealmMemberAttrs", "github.com/ninchat/ninchat-go/ninchatapi", function(Operator_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Operator = false;
			return;
		}
		this.Operator = Operator_;
	});
	UserAttrs = $pkg.UserAttrs = $newType(0, $kindStruct, "ninchatapi.UserAttrs", "UserAttrs", "github.com/ninchat/ninchat-go/ninchatapi", function(Admin_, Connected_, Deleted_, Guest_, Iconurl_, Idle_, Info_, Name_, Realname_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Admin = false;
			this.Connected = false;
			this.Deleted = false;
			this.Guest = false;
			this.Iconurl = ptrType.nil;
			this.Idle = ptrType$8.nil;
			this.Info = ptrType$66.nil;
			this.Name = ptrType.nil;
			this.Realname = ptrType.nil;
			return;
		}
		this.Admin = Admin_;
		this.Connected = Connected_;
		this.Deleted = Deleted_;
		this.Guest = Guest_;
		this.Iconurl = Iconurl_;
		this.Idle = Idle_;
		this.Info = Info_;
		this.Name = Name_;
		this.Realname = Realname_;
	});
	UnexpectedEventError = $pkg.UnexpectedEventError = $newType(0, $kindStruct, "ninchatapi.UnexpectedEventError", "UnexpectedEventError", "github.com/ninchat/ninchat-go/ninchatapi", function(Event_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Event = ptrType$15.nil;
			return;
		}
		this.Event = Event_;
	});
	AccessCreated = $pkg.AccessCreated = $newType(0, $kindStruct, "ninchatapi.AccessCreated", "AccessCreated", "github.com/ninchat/ninchat-go/ninchatapi", function(AccessKey_, AccessType_, EventId_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.AccessKey = ptrType.nil;
			this.AccessType = "";
			this.EventId = 0;
			return;
		}
		this.AccessKey = AccessKey_;
		this.AccessType = AccessType_;
		this.EventId = EventId_;
	});
	AccessFound = $pkg.AccessFound = $newType(0, $kindStruct, "ninchatapi.AccessFound", "AccessFound", "github.com/ninchat/ninchat-go/ninchatapi", function(AccessType_, ChannelAttrs_, ChannelId_, EventId_, IdentityName_, IdentityType_, RealmAttrs_, RealmId_, RealmMember_, UserAttrs_, UserId_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.AccessType = "";
			this.ChannelAttrs = ptrType$1.nil;
			this.ChannelId = ptrType.nil;
			this.EventId = 0;
			this.IdentityName = ptrType.nil;
			this.IdentityType = ptrType.nil;
			this.RealmAttrs = ptrType$2.nil;
			this.RealmId = ptrType.nil;
			this.RealmMember = false;
			this.UserAttrs = ptrType$3.nil;
			this.UserId = ptrType.nil;
			return;
		}
		this.AccessType = AccessType_;
		this.ChannelAttrs = ChannelAttrs_;
		this.ChannelId = ChannelId_;
		this.EventId = EventId_;
		this.IdentityName = IdentityName_;
		this.IdentityType = IdentityType_;
		this.RealmAttrs = RealmAttrs_;
		this.RealmId = RealmId_;
		this.RealmMember = RealmMember_;
		this.UserAttrs = UserAttrs_;
		this.UserId = UserId_;
	});
	AudienceEnqueued = $pkg.AudienceEnqueued = $newType(0, $kindStruct, "ninchatapi.AudienceEnqueued", "AudienceEnqueued", "github.com/ninchat/ninchat-go/ninchatapi", function(EventId_, QueueAttrs_, QueueId_, QueuePosition_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.EventId = 0;
			this.QueueAttrs = ptrType$4.nil;
			this.QueueId = "";
			this.QueuePosition = 0;
			return;
		}
		this.EventId = EventId_;
		this.QueueAttrs = QueueAttrs_;
		this.QueueId = QueueId_;
		this.QueuePosition = QueuePosition_;
	});
	ChannelDeleted = $pkg.ChannelDeleted = $newType(0, $kindStruct, "ninchatapi.ChannelDeleted", "ChannelDeleted", "github.com/ninchat/ninchat-go/ninchatapi", function(ChannelId_, EventId_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.ChannelId = "";
			this.EventId = 0;
			return;
		}
		this.ChannelId = ChannelId_;
		this.EventId = EventId_;
	});
	ChannelFound = $pkg.ChannelFound = $newType(0, $kindStruct, "ninchatapi.ChannelFound", "ChannelFound", "github.com/ninchat/ninchat-go/ninchatapi", function(ChannelAttrs_, ChannelId_, ChannelMembers_, ChannelStatus_, EventId_, RealmId_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.ChannelAttrs = ptrType$1.nil;
			this.ChannelId = "";
			this.ChannelMembers = false;
			this.ChannelStatus = ptrType.nil;
			this.EventId = 0;
			this.RealmId = ptrType.nil;
			return;
		}
		this.ChannelAttrs = ChannelAttrs_;
		this.ChannelId = ChannelId_;
		this.ChannelMembers = ChannelMembers_;
		this.ChannelStatus = ChannelStatus_;
		this.EventId = EventId_;
		this.RealmId = RealmId_;
	});
	ChannelJoined = $pkg.ChannelJoined = $newType(0, $kindStruct, "ninchatapi.ChannelJoined", "ChannelJoined", "github.com/ninchat/ninchat-go/ninchatapi", function(ChannelAttrs_, ChannelId_, ChannelMembers_, EventId_, RealmId_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.ChannelAttrs = ptrType$1.nil;
			this.ChannelId = "";
			this.ChannelMembers = false;
			this.EventId = 0;
			this.RealmId = ptrType.nil;
			return;
		}
		this.ChannelAttrs = ChannelAttrs_;
		this.ChannelId = ChannelId_;
		this.ChannelMembers = ChannelMembers_;
		this.EventId = EventId_;
		this.RealmId = RealmId_;
	});
	ChannelMemberJoined = $pkg.ChannelMemberJoined = $newType(0, $kindStruct, "ninchatapi.ChannelMemberJoined", "ChannelMemberJoined", "github.com/ninchat/ninchat-go/ninchatapi", function(ChannelId_, EventId_, MemberAttrs_, PuppetAttrs_, UserAttrs_, UserId_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.ChannelId = "";
			this.EventId = 0;
			this.MemberAttrs = ptrType$5.nil;
			this.PuppetAttrs = ptrType$6.nil;
			this.UserAttrs = ptrType$3.nil;
			this.UserId = "";
			return;
		}
		this.ChannelId = ChannelId_;
		this.EventId = EventId_;
		this.MemberAttrs = MemberAttrs_;
		this.PuppetAttrs = PuppetAttrs_;
		this.UserAttrs = UserAttrs_;
		this.UserId = UserId_;
	});
	ChannelMemberParted = $pkg.ChannelMemberParted = $newType(0, $kindStruct, "ninchatapi.ChannelMemberParted", "ChannelMemberParted", "github.com/ninchat/ninchat-go/ninchatapi", function(ChannelId_, EventId_, RealmId_, UserId_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.ChannelId = ptrType.nil;
			this.EventId = 0;
			this.RealmId = ptrType.nil;
			this.UserId = "";
			return;
		}
		this.ChannelId = ChannelId_;
		this.EventId = EventId_;
		this.RealmId = RealmId_;
		this.UserId = UserId_;
	});
	ChannelMemberUpdated = $pkg.ChannelMemberUpdated = $newType(0, $kindStruct, "ninchatapi.ChannelMemberUpdated", "ChannelMemberUpdated", "github.com/ninchat/ninchat-go/ninchatapi", function(ChannelId_, EventId_, MemberAttrs_, RealmId_, UserId_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.ChannelId = ptrType.nil;
			this.EventId = 0;
			this.MemberAttrs = ptrType$5.nil;
			this.RealmId = ptrType.nil;
			this.UserId = "";
			return;
		}
		this.ChannelId = ChannelId_;
		this.EventId = EventId_;
		this.MemberAttrs = MemberAttrs_;
		this.RealmId = RealmId_;
		this.UserId = UserId_;
	});
	ChannelParted = $pkg.ChannelParted = $newType(0, $kindStruct, "ninchatapi.ChannelParted", "ChannelParted", "github.com/ninchat/ninchat-go/ninchatapi", function(ChannelId_, EventId_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.ChannelId = "";
			this.EventId = 0;
			return;
		}
		this.ChannelId = ChannelId_;
		this.EventId = EventId_;
	});
	ChannelUpdated = $pkg.ChannelUpdated = $newType(0, $kindStruct, "ninchatapi.ChannelUpdated", "ChannelUpdated", "github.com/ninchat/ninchat-go/ninchatapi", function(ChannelAttrs_, ChannelId_, EventId_, RealmId_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.ChannelAttrs = ptrType$1.nil;
			this.ChannelId = "";
			this.EventId = 0;
			this.RealmId = ptrType.nil;
			return;
		}
		this.ChannelAttrs = ChannelAttrs_;
		this.ChannelId = ChannelId_;
		this.EventId = EventId_;
		this.RealmId = RealmId_;
	});
	DialogueUpdated = $pkg.DialogueUpdated = $newType(0, $kindStruct, "ninchatapi.DialogueUpdated", "DialogueUpdated", "github.com/ninchat/ninchat-go/ninchatapi", function(AudienceMetadata_, DialogueMembers_, DialogueStatus_, EventId_, UserId_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.AudienceMetadata = false;
			this.DialogueMembers = false;
			this.DialogueStatus = ptrType.nil;
			this.EventId = 0;
			this.UserId = "";
			return;
		}
		this.AudienceMetadata = AudienceMetadata_;
		this.DialogueMembers = DialogueMembers_;
		this.DialogueStatus = DialogueStatus_;
		this.EventId = EventId_;
		this.UserId = UserId_;
	});
	Error = $pkg.Error = $newType(0, $kindStruct, "ninchatapi.Error", "Error", "github.com/ninchat/ninchat-go/ninchatapi", function(ChannelId_, ErrorReason_, ErrorType_, EventId_, IdentityName_, IdentityType_, MessageType_, QueueId_, RealmId_, UserId_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.ChannelId = ptrType.nil;
			this.ErrorReason = ptrType.nil;
			this.ErrorType = "";
			this.EventId = 0;
			this.IdentityName = ptrType.nil;
			this.IdentityType = ptrType.nil;
			this.MessageType = ptrType.nil;
			this.QueueId = ptrType.nil;
			this.RealmId = ptrType.nil;
			this.UserId = ptrType.nil;
			return;
		}
		this.ChannelId = ChannelId_;
		this.ErrorReason = ErrorReason_;
		this.ErrorType = ErrorType_;
		this.EventId = EventId_;
		this.IdentityName = IdentityName_;
		this.IdentityType = IdentityType_;
		this.MessageType = MessageType_;
		this.QueueId = QueueId_;
		this.RealmId = RealmId_;
		this.UserId = UserId_;
	});
	HistoryDiscarded = $pkg.HistoryDiscarded = $newType(0, $kindStruct, "ninchatapi.HistoryDiscarded", "HistoryDiscarded", "github.com/ninchat/ninchat-go/ninchatapi", function(ChannelId_, EventId_, MessageId_, UserId_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.ChannelId = ptrType.nil;
			this.EventId = 0;
			this.MessageId = "";
			this.UserId = ptrType.nil;
			return;
		}
		this.ChannelId = ChannelId_;
		this.EventId = EventId_;
		this.MessageId = MessageId_;
		this.UserId = UserId_;
	});
	HistoryResults = $pkg.HistoryResults = $newType(0, $kindStruct, "ninchatapi.HistoryResults", "HistoryResults", "github.com/ninchat/ninchat-go/ninchatapi", function(ChannelId_, EventId_, HistoryLength_, MessageId_, UserId_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.ChannelId = ptrType.nil;
			this.EventId = 0;
			this.HistoryLength = 0;
			this.MessageId = ptrType.nil;
			this.UserId = ptrType.nil;
			return;
		}
		this.ChannelId = ChannelId_;
		this.EventId = EventId_;
		this.HistoryLength = HistoryLength_;
		this.MessageId = MessageId_;
		this.UserId = UserId_;
	});
	IdentityCreated = $pkg.IdentityCreated = $newType(0, $kindStruct, "ninchatapi.IdentityCreated", "IdentityCreated", "github.com/ninchat/ninchat-go/ninchatapi", function(EventId_, IdentityAttrs_, IdentityName_, IdentityType_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.EventId = 0;
			this.IdentityAttrs = ptrType$7.nil;
			this.IdentityName = "";
			this.IdentityType = "";
			return;
		}
		this.EventId = EventId_;
		this.IdentityAttrs = IdentityAttrs_;
		this.IdentityName = IdentityName_;
		this.IdentityType = IdentityType_;
	});
	IdentityDeleted = $pkg.IdentityDeleted = $newType(0, $kindStruct, "ninchatapi.IdentityDeleted", "IdentityDeleted", "github.com/ninchat/ninchat-go/ninchatapi", function(EventId_, IdentityName_, IdentityType_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.EventId = 0;
			this.IdentityName = "";
			this.IdentityType = "";
			return;
		}
		this.EventId = EventId_;
		this.IdentityName = IdentityName_;
		this.IdentityType = IdentityType_;
	});
	IdentityFound = $pkg.IdentityFound = $newType(0, $kindStruct, "ninchatapi.IdentityFound", "IdentityFound", "github.com/ninchat/ninchat-go/ninchatapi", function(EventId_, IdentityAttrs_, IdentityName_, IdentityType_, UserId_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.EventId = 0;
			this.IdentityAttrs = ptrType$7.nil;
			this.IdentityName = "";
			this.IdentityType = "";
			this.UserId = "";
			return;
		}
		this.EventId = EventId_;
		this.IdentityAttrs = IdentityAttrs_;
		this.IdentityName = IdentityName_;
		this.IdentityType = IdentityType_;
		this.UserId = UserId_;
	});
	IdentityUpdated = $pkg.IdentityUpdated = $newType(0, $kindStruct, "ninchatapi.IdentityUpdated", "IdentityUpdated", "github.com/ninchat/ninchat-go/ninchatapi", function(EventId_, IdentityAttrs_, IdentityName_, IdentityType_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.EventId = 0;
			this.IdentityAttrs = ptrType$7.nil;
			this.IdentityName = "";
			this.IdentityType = "";
			return;
		}
		this.EventId = EventId_;
		this.IdentityAttrs = IdentityAttrs_;
		this.IdentityName = IdentityName_;
		this.IdentityType = IdentityType_;
	});
	MasterKeyCreated = $pkg.MasterKeyCreated = $newType(0, $kindStruct, "ninchatapi.MasterKeyCreated", "MasterKeyCreated", "github.com/ninchat/ninchat-go/ninchatapi", function(EventId_, MasterKeyId_, MasterKeySecret_, MasterKeyType_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.EventId = 0;
			this.MasterKeyId = "";
			this.MasterKeySecret = ptrType.nil;
			this.MasterKeyType = "";
			return;
		}
		this.EventId = EventId_;
		this.MasterKeyId = MasterKeyId_;
		this.MasterKeySecret = MasterKeySecret_;
		this.MasterKeyType = MasterKeyType_;
	});
	MasterKeyDeleted = $pkg.MasterKeyDeleted = $newType(0, $kindStruct, "ninchatapi.MasterKeyDeleted", "MasterKeyDeleted", "github.com/ninchat/ninchat-go/ninchatapi", function(EventId_, MasterKeyId_, MasterKeyType_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.EventId = 0;
			this.MasterKeyId = "";
			this.MasterKeyType = "";
			return;
		}
		this.EventId = EventId_;
		this.MasterKeyId = MasterKeyId_;
		this.MasterKeyType = MasterKeyType_;
	});
	MasterKeysFound = $pkg.MasterKeysFound = $newType(0, $kindStruct, "ninchatapi.MasterKeysFound", "MasterKeysFound", "github.com/ninchat/ninchat-go/ninchatapi", function(EventId_, MasterKeys_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.EventId = 0;
			this.MasterKeys = false;
			return;
		}
		this.EventId = EventId_;
		this.MasterKeys = MasterKeys_;
	});
	MessageReceived = $pkg.MessageReceived = $newType(0, $kindStruct, "ninchatapi.MessageReceived", "MessageReceived", "github.com/ninchat/ninchat-go/ninchatapi", function(ChannelId_, EventId_, HistoryLength_, MessageFold_, MessageHidden_, MessageId_, MessageRecipientIds_, MessageTime_, MessageTtl_, MessageType_, MessageUserId_, MessageUserName_, UserId_, payload_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.ChannelId = ptrType.nil;
			this.EventId = 0;
			this.HistoryLength = ptrType$8.nil;
			this.MessageFold = false;
			this.MessageHidden = false;
			this.MessageId = "";
			this.MessageRecipientIds = sliceType.nil;
			this.MessageTime = 0;
			this.MessageTtl = ptrType$9.nil;
			this.MessageType = "";
			this.MessageUserId = ptrType.nil;
			this.MessageUserName = ptrType.nil;
			this.UserId = ptrType.nil;
			this.payload = sliceType$1.nil;
			return;
		}
		this.ChannelId = ChannelId_;
		this.EventId = EventId_;
		this.HistoryLength = HistoryLength_;
		this.MessageFold = MessageFold_;
		this.MessageHidden = MessageHidden_;
		this.MessageId = MessageId_;
		this.MessageRecipientIds = MessageRecipientIds_;
		this.MessageTime = MessageTime_;
		this.MessageTtl = MessageTtl_;
		this.MessageType = MessageType_;
		this.MessageUserId = MessageUserId_;
		this.MessageUserName = MessageUserName_;
		this.UserId = UserId_;
		this.payload = payload_;
	});
	MessageUpdated = $pkg.MessageUpdated = $newType(0, $kindStruct, "ninchatapi.MessageUpdated", "MessageUpdated", "github.com/ninchat/ninchat-go/ninchatapi", function(ChannelId_, EventId_, MessageHidden_, MessageId_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.ChannelId = ptrType.nil;
			this.EventId = 0;
			this.MessageHidden = false;
			this.MessageId = "";
			return;
		}
		this.ChannelId = ChannelId_;
		this.EventId = EventId_;
		this.MessageHidden = MessageHidden_;
		this.MessageId = MessageId_;
	});
	Pong = $pkg.Pong = $newType(0, $kindStruct, "ninchatapi.Pong", "Pong", "github.com/ninchat/ninchat-go/ninchatapi", function(EventId_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.EventId = 0;
			return;
		}
		this.EventId = EventId_;
	});
	QueueCreated = $pkg.QueueCreated = $newType(0, $kindStruct, "ninchatapi.QueueCreated", "QueueCreated", "github.com/ninchat/ninchat-go/ninchatapi", function(EventId_, QueueAttrs_, QueueId_, RealmId_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.EventId = 0;
			this.QueueAttrs = ptrType$4.nil;
			this.QueueId = "";
			this.RealmId = ptrType.nil;
			return;
		}
		this.EventId = EventId_;
		this.QueueAttrs = QueueAttrs_;
		this.QueueId = QueueId_;
		this.RealmId = RealmId_;
	});
	QueueDeleted = $pkg.QueueDeleted = $newType(0, $kindStruct, "ninchatapi.QueueDeleted", "QueueDeleted", "github.com/ninchat/ninchat-go/ninchatapi", function(EventId_, QueueId_, RealmId_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.EventId = 0;
			this.QueueId = "";
			this.RealmId = ptrType.nil;
			return;
		}
		this.EventId = EventId_;
		this.QueueId = QueueId_;
		this.RealmId = RealmId_;
	});
	QueueFound = $pkg.QueueFound = $newType(0, $kindStruct, "ninchatapi.QueueFound", "QueueFound", "github.com/ninchat/ninchat-go/ninchatapi", function(EventId_, QueueAttrs_, QueueId_, QueueMembers_, QueuePosition_, RealmId_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.EventId = 0;
			this.QueueAttrs = ptrType$4.nil;
			this.QueueId = "";
			this.QueueMembers = false;
			this.QueuePosition = ptrType$8.nil;
			this.RealmId = ptrType.nil;
			return;
		}
		this.EventId = EventId_;
		this.QueueAttrs = QueueAttrs_;
		this.QueueId = QueueId_;
		this.QueueMembers = QueueMembers_;
		this.QueuePosition = QueuePosition_;
		this.RealmId = RealmId_;
	});
	QueueJoined = $pkg.QueueJoined = $newType(0, $kindStruct, "ninchatapi.QueueJoined", "QueueJoined", "github.com/ninchat/ninchat-go/ninchatapi", function(EventId_, QueueAttrs_, QueueId_, RealmId_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.EventId = 0;
			this.QueueAttrs = ptrType$4.nil;
			this.QueueId = "";
			this.RealmId = ptrType.nil;
			return;
		}
		this.EventId = EventId_;
		this.QueueAttrs = QueueAttrs_;
		this.QueueId = QueueId_;
		this.RealmId = RealmId_;
	});
	QueueMemberJoined = $pkg.QueueMemberJoined = $newType(0, $kindStruct, "ninchatapi.QueueMemberJoined", "QueueMemberJoined", "github.com/ninchat/ninchat-go/ninchatapi", function(EventId_, MemberAttrs_, QueueId_, UserAttrs_, UserId_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.EventId = 0;
			this.MemberAttrs = ptrType$10.nil;
			this.QueueId = "";
			this.UserAttrs = ptrType$3.nil;
			this.UserId = "";
			return;
		}
		this.EventId = EventId_;
		this.MemberAttrs = MemberAttrs_;
		this.QueueId = QueueId_;
		this.UserAttrs = UserAttrs_;
		this.UserId = UserId_;
	});
	QueueMemberParted = $pkg.QueueMemberParted = $newType(0, $kindStruct, "ninchatapi.QueueMemberParted", "QueueMemberParted", "github.com/ninchat/ninchat-go/ninchatapi", function(EventId_, QueueId_, UserId_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.EventId = 0;
			this.QueueId = "";
			this.UserId = "";
			return;
		}
		this.EventId = EventId_;
		this.QueueId = QueueId_;
		this.UserId = UserId_;
	});
	QueueParted = $pkg.QueueParted = $newType(0, $kindStruct, "ninchatapi.QueueParted", "QueueParted", "github.com/ninchat/ninchat-go/ninchatapi", function(EventId_, QueueId_, RealmId_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.EventId = 0;
			this.QueueId = "";
			this.RealmId = ptrType.nil;
			return;
		}
		this.EventId = EventId_;
		this.QueueId = QueueId_;
		this.RealmId = RealmId_;
	});
	QueueTranscriptsDeleted = $pkg.QueueTranscriptsDeleted = $newType(0, $kindStruct, "ninchatapi.QueueTranscriptsDeleted", "QueueTranscriptsDeleted", "github.com/ninchat/ninchat-go/ninchatapi", function(EventId_, IntervalBegin_, IntervalEnd_, QueueId_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.EventId = 0;
			this.IntervalBegin = 0;
			this.IntervalEnd = 0;
			this.QueueId = "";
			return;
		}
		this.EventId = EventId_;
		this.IntervalBegin = IntervalBegin_;
		this.IntervalEnd = IntervalEnd_;
		this.QueueId = QueueId_;
	});
	QueueTranscriptsFound = $pkg.QueueTranscriptsFound = $newType(0, $kindStruct, "ninchatapi.QueueTranscriptsFound", "QueueTranscriptsFound", "github.com/ninchat/ninchat-go/ninchatapi", function(EventId_, QueueId_, QueueTranscripts_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.EventId = 0;
			this.QueueId = "";
			this.QueueTranscripts = sliceType$2.nil;
			return;
		}
		this.EventId = EventId_;
		this.QueueId = QueueId_;
		this.QueueTranscripts = QueueTranscripts_;
	});
	QueueUpdated = $pkg.QueueUpdated = $newType(0, $kindStruct, "ninchatapi.QueueUpdated", "QueueUpdated", "github.com/ninchat/ninchat-go/ninchatapi", function(EventId_, QueueAttrs_, QueueId_, QueuePosition_, RealmId_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.EventId = 0;
			this.QueueAttrs = ptrType$4.nil;
			this.QueueId = "";
			this.QueuePosition = ptrType$8.nil;
			this.RealmId = ptrType.nil;
			return;
		}
		this.EventId = EventId_;
		this.QueueAttrs = QueueAttrs_;
		this.QueueId = QueueId_;
		this.QueuePosition = QueuePosition_;
		this.RealmId = RealmId_;
	});
	RealmDeleted = $pkg.RealmDeleted = $newType(0, $kindStruct, "ninchatapi.RealmDeleted", "RealmDeleted", "github.com/ninchat/ninchat-go/ninchatapi", function(EventId_, RealmId_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.EventId = 0;
			this.RealmId = "";
			return;
		}
		this.EventId = EventId_;
		this.RealmId = RealmId_;
	});
	RealmFound = $pkg.RealmFound = $newType(0, $kindStruct, "ninchatapi.RealmFound", "RealmFound", "github.com/ninchat/ninchat-go/ninchatapi", function(EventId_, RealmAttrs_, RealmId_, RealmMembers_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.EventId = 0;
			this.RealmAttrs = ptrType$2.nil;
			this.RealmId = "";
			this.RealmMembers = false;
			return;
		}
		this.EventId = EventId_;
		this.RealmAttrs = RealmAttrs_;
		this.RealmId = RealmId_;
		this.RealmMembers = RealmMembers_;
	});
	RealmJoined = $pkg.RealmJoined = $newType(0, $kindStruct, "ninchatapi.RealmJoined", "RealmJoined", "github.com/ninchat/ninchat-go/ninchatapi", function(EventId_, RealmAttrs_, RealmId_, RealmMembers_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.EventId = 0;
			this.RealmAttrs = ptrType$2.nil;
			this.RealmId = "";
			this.RealmMembers = false;
			return;
		}
		this.EventId = EventId_;
		this.RealmAttrs = RealmAttrs_;
		this.RealmId = RealmId_;
		this.RealmMembers = RealmMembers_;
	});
	RealmMemberJoined = $pkg.RealmMemberJoined = $newType(0, $kindStruct, "ninchatapi.RealmMemberJoined", "RealmMemberJoined", "github.com/ninchat/ninchat-go/ninchatapi", function(EventId_, MemberAttrs_, PuppetAttrs_, RealmId_, UserAttrs_, UserId_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.EventId = 0;
			this.MemberAttrs = ptrType$12.nil;
			this.PuppetAttrs = ptrType$6.nil;
			this.RealmId = "";
			this.UserAttrs = ptrType$3.nil;
			this.UserId = "";
			return;
		}
		this.EventId = EventId_;
		this.MemberAttrs = MemberAttrs_;
		this.PuppetAttrs = PuppetAttrs_;
		this.RealmId = RealmId_;
		this.UserAttrs = UserAttrs_;
		this.UserId = UserId_;
	});
	RealmMemberParted = $pkg.RealmMemberParted = $newType(0, $kindStruct, "ninchatapi.RealmMemberParted", "RealmMemberParted", "github.com/ninchat/ninchat-go/ninchatapi", function(ChannelId_, EventId_, RealmId_, UserId_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.ChannelId = ptrType.nil;
			this.EventId = 0;
			this.RealmId = ptrType.nil;
			this.UserId = "";
			return;
		}
		this.ChannelId = ChannelId_;
		this.EventId = EventId_;
		this.RealmId = RealmId_;
		this.UserId = UserId_;
	});
	RealmMemberUpdated = $pkg.RealmMemberUpdated = $newType(0, $kindStruct, "ninchatapi.RealmMemberUpdated", "RealmMemberUpdated", "github.com/ninchat/ninchat-go/ninchatapi", function(EventId_, MemberAttrs_, RealmId_, UserId_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.EventId = 0;
			this.MemberAttrs = ptrType$12.nil;
			this.RealmId = "";
			this.UserId = "";
			return;
		}
		this.EventId = EventId_;
		this.MemberAttrs = MemberAttrs_;
		this.RealmId = RealmId_;
		this.UserId = UserId_;
	});
	RealmParted = $pkg.RealmParted = $newType(0, $kindStruct, "ninchatapi.RealmParted", "RealmParted", "github.com/ninchat/ninchat-go/ninchatapi", function(EventId_, RealmId_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.EventId = 0;
			this.RealmId = "";
			return;
		}
		this.EventId = EventId_;
		this.RealmId = RealmId_;
	});
	RealmQueuesFound = $pkg.RealmQueuesFound = $newType(0, $kindStruct, "ninchatapi.RealmQueuesFound", "RealmQueuesFound", "github.com/ninchat/ninchat-go/ninchatapi", function(EventId_, RealmId_, RealmQueues_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.EventId = 0;
			this.RealmId = "";
			this.RealmQueues = false;
			return;
		}
		this.EventId = EventId_;
		this.RealmId = RealmId_;
		this.RealmQueues = RealmQueues_;
	});
	RealmUpdated = $pkg.RealmUpdated = $newType(0, $kindStruct, "ninchatapi.RealmUpdated", "RealmUpdated", "github.com/ninchat/ninchat-go/ninchatapi", function(EventId_, RealmAttrs_, RealmId_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.EventId = 0;
			this.RealmAttrs = ptrType$2.nil;
			this.RealmId = "";
			return;
		}
		this.EventId = EventId_;
		this.RealmAttrs = RealmAttrs_;
		this.RealmId = RealmId_;
	});
	SearchResults = $pkg.SearchResults = $newType(0, $kindStruct, "ninchatapi.SearchResults", "SearchResults", "github.com/ninchat/ninchat-go/ninchatapi", function(Channels_, EventId_, Users_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Channels = false;
			this.EventId = 0;
			this.Users = false;
			return;
		}
		this.Channels = Channels_;
		this.EventId = EventId_;
		this.Users = Users_;
	});
	SessionCreated = $pkg.SessionCreated = $newType(0, $kindStruct, "ninchatapi.SessionCreated", "SessionCreated", "github.com/ninchat/ninchat-go/ninchatapi", function(EventId_, PuppetMasters_, SessionHost_, SessionId_, UserAccount_, UserAttrs_, UserAuth_, UserChannels_, UserDialogues_, UserId_, UserIdentities_, UserQueues_, UserRealms_, UserRealmsMember_, UserSettings_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.EventId = 0;
			this.PuppetMasters = false;
			this.SessionHost = ptrType.nil;
			this.SessionId = "";
			this.UserAccount = ptrType$13.nil;
			this.UserAttrs = ptrType$3.nil;
			this.UserAuth = ptrType.nil;
			this.UserChannels = false;
			this.UserDialogues = false;
			this.UserId = "";
			this.UserIdentities = false;
			this.UserQueues = false;
			this.UserRealms = false;
			this.UserRealmsMember = false;
			this.UserSettings = false;
			return;
		}
		this.EventId = EventId_;
		this.PuppetMasters = PuppetMasters_;
		this.SessionHost = SessionHost_;
		this.SessionId = SessionId_;
		this.UserAccount = UserAccount_;
		this.UserAttrs = UserAttrs_;
		this.UserAuth = UserAuth_;
		this.UserChannels = UserChannels_;
		this.UserDialogues = UserDialogues_;
		this.UserId = UserId_;
		this.UserIdentities = UserIdentities_;
		this.UserQueues = UserQueues_;
		this.UserRealms = UserRealms_;
		this.UserRealmsMember = UserRealmsMember_;
		this.UserSettings = UserSettings_;
	});
	SessionStatusUpdated = $pkg.SessionStatusUpdated = $newType(0, $kindStruct, "ninchatapi.SessionStatusUpdated", "SessionStatusUpdated", "github.com/ninchat/ninchat-go/ninchatapi", function(ChannelId_, EventId_, MessageId_, UserId_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.ChannelId = ptrType.nil;
			this.EventId = 0;
			this.MessageId = "";
			this.UserId = ptrType.nil;
			return;
		}
		this.ChannelId = ChannelId_;
		this.EventId = EventId_;
		this.MessageId = MessageId_;
		this.UserId = UserId_;
	});
	TranscriptContents = $pkg.TranscriptContents = $newType(0, $kindStruct, "ninchatapi.TranscriptContents", "TranscriptContents", "github.com/ninchat/ninchat-go/ninchatapi", function(AudienceMetadata_, DialogueMembers_, EventId_, MessageId_, TranscriptMessages_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.AudienceMetadata = false;
			this.DialogueMembers = false;
			this.EventId = 0;
			this.MessageId = ptrType.nil;
			this.TranscriptMessages = sliceType$3.nil;
			return;
		}
		this.AudienceMetadata = AudienceMetadata_;
		this.DialogueMembers = DialogueMembers_;
		this.EventId = EventId_;
		this.MessageId = MessageId_;
		this.TranscriptMessages = TranscriptMessages_;
	});
	TranscriptDeleted = $pkg.TranscriptDeleted = $newType(0, $kindStruct, "ninchatapi.TranscriptDeleted", "TranscriptDeleted", "github.com/ninchat/ninchat-go/ninchatapi", function(DialogueId_, EventId_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.DialogueId = sliceType.nil;
			this.EventId = 0;
			return;
		}
		this.DialogueId = DialogueId_;
		this.EventId = EventId_;
	});
	UserDeleted = $pkg.UserDeleted = $newType(0, $kindStruct, "ninchatapi.UserDeleted", "UserDeleted", "github.com/ninchat/ninchat-go/ninchatapi", function(EventId_, UserId_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.EventId = 0;
			this.UserId = "";
			return;
		}
		this.EventId = EventId_;
		this.UserId = UserId_;
	});
	UserFound = $pkg.UserFound = $newType(0, $kindStruct, "ninchatapi.UserFound", "UserFound", "github.com/ninchat/ninchat-go/ninchatapi", function(AudienceMetadata_, DialogueMembers_, DialogueStatus_, EventId_, PuppetMasters_, UserAccount_, UserAttrs_, UserChannels_, UserDialogues_, UserId_, UserIdentities_, UserQueues_, UserRealms_, UserRealmsMember_, UserSettings_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.AudienceMetadata = false;
			this.DialogueMembers = false;
			this.DialogueStatus = ptrType.nil;
			this.EventId = 0;
			this.PuppetMasters = false;
			this.UserAccount = ptrType$13.nil;
			this.UserAttrs = ptrType$3.nil;
			this.UserChannels = false;
			this.UserDialogues = false;
			this.UserId = "";
			this.UserIdentities = false;
			this.UserQueues = false;
			this.UserRealms = false;
			this.UserRealmsMember = false;
			this.UserSettings = false;
			return;
		}
		this.AudienceMetadata = AudienceMetadata_;
		this.DialogueMembers = DialogueMembers_;
		this.DialogueStatus = DialogueStatus_;
		this.EventId = EventId_;
		this.PuppetMasters = PuppetMasters_;
		this.UserAccount = UserAccount_;
		this.UserAttrs = UserAttrs_;
		this.UserChannels = UserChannels_;
		this.UserDialogues = UserDialogues_;
		this.UserId = UserId_;
		this.UserIdentities = UserIdentities_;
		this.UserQueues = UserQueues_;
		this.UserRealms = UserRealms_;
		this.UserRealmsMember = UserRealmsMember_;
		this.UserSettings = UserSettings_;
	});
	UserUpdated = $pkg.UserUpdated = $newType(0, $kindStruct, "ninchatapi.UserUpdated", "UserUpdated", "github.com/ninchat/ninchat-go/ninchatapi", function(EventId_, PuppetMasters_, UserAccount_, UserAttrs_, UserId_, UserSettings_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.EventId = 0;
			this.PuppetMasters = false;
			this.UserAccount = ptrType$13.nil;
			this.UserAttrs = ptrType$3.nil;
			this.UserId = "";
			this.UserSettings = false;
			return;
		}
		this.EventId = EventId_;
		this.PuppetMasters = PuppetMasters_;
		this.UserAccount = UserAccount_;
		this.UserAttrs = UserAttrs_;
		this.UserId = UserId_;
		this.UserSettings = UserSettings_;
	});
	ChannelMember = $pkg.ChannelMember = $newType(0, $kindStruct, "ninchatapi.ChannelMember", "ChannelMember", "github.com/ninchat/ninchat-go/ninchatapi", function(MemberAttrs_, PuppetAttrs_, UserAttrs_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.MemberAttrs = ptrType$5.nil;
			this.PuppetAttrs = ptrType$6.nil;
			this.UserAttrs = ptrType$3.nil;
			return;
		}
		this.MemberAttrs = MemberAttrs_;
		this.PuppetAttrs = PuppetAttrs_;
		this.UserAttrs = UserAttrs_;
	});
	ChannelResult = $pkg.ChannelResult = $newType(0, $kindStruct, "ninchatapi.ChannelResult", "ChannelResult", "github.com/ninchat/ninchat-go/ninchatapi", function(ChannelAttrs_, RealmId_, Weight_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.ChannelAttrs = ptrType$1.nil;
			this.RealmId = ptrType.nil;
			this.Weight = 0;
			return;
		}
		this.ChannelAttrs = ChannelAttrs_;
		this.RealmId = RealmId_;
		this.Weight = Weight_;
	});
	PuppetMaster = $pkg.PuppetMaster = $newType(0, $kindStruct, "ninchatapi.PuppetMaster", "PuppetMaster", "github.com/ninchat/ninchat-go/ninchatapi", function(PuppetAttrs_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.PuppetAttrs = ptrType$6.nil;
			return;
		}
		this.PuppetAttrs = PuppetAttrs_;
	});
	QueueMember = $pkg.QueueMember = $newType(0, $kindStruct, "ninchatapi.QueueMember", "QueueMember", "github.com/ninchat/ninchat-go/ninchatapi", function(MemberAttrs_, UserAttrs_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.MemberAttrs = ptrType$10.nil;
			this.UserAttrs = ptrType$3.nil;
			return;
		}
		this.MemberAttrs = MemberAttrs_;
		this.UserAttrs = UserAttrs_;
	});
	QueueTranscript = $pkg.QueueTranscript = $newType(0, $kindStruct, "ninchatapi.QueueTranscript", "QueueTranscript", "github.com/ninchat/ninchat-go/ninchatapi", function(AcceptTime_, AgentId_, CompleteTime_, DialogueId_, FinishTime_, Rating_, RequestTime_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.AcceptTime = 0;
			this.AgentId = "";
			this.CompleteTime = 0;
			this.DialogueId = sliceType.nil;
			this.FinishTime = 0;
			this.Rating = ptrType$8.nil;
			this.RequestTime = 0;
			return;
		}
		this.AcceptTime = AcceptTime_;
		this.AgentId = AgentId_;
		this.CompleteTime = CompleteTime_;
		this.DialogueId = DialogueId_;
		this.FinishTime = FinishTime_;
		this.Rating = Rating_;
		this.RequestTime = RequestTime_;
	});
	RealmMember = $pkg.RealmMember = $newType(0, $kindStruct, "ninchatapi.RealmMember", "RealmMember", "github.com/ninchat/ninchat-go/ninchatapi", function(MemberAttrs_, PuppetAttrs_, UserAttrs_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.MemberAttrs = ptrType$12.nil;
			this.PuppetAttrs = ptrType$6.nil;
			this.UserAttrs = ptrType$3.nil;
			return;
		}
		this.MemberAttrs = MemberAttrs_;
		this.PuppetAttrs = PuppetAttrs_;
		this.UserAttrs = UserAttrs_;
	});
	RealmQueue = $pkg.RealmQueue = $newType(0, $kindStruct, "ninchatapi.RealmQueue", "RealmQueue", "github.com/ninchat/ninchat-go/ninchatapi", function(QueueAttrs_, QueuePosition_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.QueueAttrs = ptrType$4.nil;
			this.QueuePosition = ptrType$8.nil;
			return;
		}
		this.QueueAttrs = QueueAttrs_;
		this.QueuePosition = QueuePosition_;
	});
	TranscriptMessage = $pkg.TranscriptMessage = $newType(0, $kindStruct, "ninchatapi.TranscriptMessage", "TranscriptMessage", "github.com/ninchat/ninchat-go/ninchatapi", function(MessageFold_, MessageId_, MessageTime_, MessageType_, MessageUserId_, MessageUserName_, Payload_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.MessageFold = false;
			this.MessageId = "";
			this.MessageTime = 0;
			this.MessageType = "";
			this.MessageUserId = ptrType.nil;
			this.MessageUserName = ptrType.nil;
			this.Payload = $ifaceNil;
			return;
		}
		this.MessageFold = MessageFold_;
		this.MessageId = MessageId_;
		this.MessageTime = MessageTime_;
		this.MessageType = MessageType_;
		this.MessageUserId = MessageUserId_;
		this.MessageUserName = MessageUserName_;
		this.Payload = Payload_;
	});
	UserAccount = $pkg.UserAccount = $newType(0, $kindStruct, "ninchatapi.UserAccount", "UserAccount", "github.com/ninchat/ninchat-go/ninchatapi", function(Channels_, QueueMembers_, Queues_, Realms_, Subscriptions_, Uploads_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Channels = ptrType$68.nil;
			this.QueueMembers = ptrType$69.nil;
			this.Queues = ptrType$68.nil;
			this.Realms = ptrType$68.nil;
			this.Subscriptions = sliceType$5.nil;
			this.Uploads = ptrType$86.nil;
			return;
		}
		this.Channels = Channels_;
		this.QueueMembers = QueueMembers_;
		this.Queues = Queues_;
		this.Realms = Realms_;
		this.Subscriptions = Subscriptions_;
		this.Uploads = Uploads_;
	});
	UserAccountExtent = $pkg.UserAccountExtent = $newType(0, $kindStruct, "ninchatapi.UserAccountExtent", "UserAccountExtent", "github.com/ninchat/ninchat-go/ninchatapi", function(Available_, Quota_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Available = 0;
			this.Quota = 0;
			return;
		}
		this.Available = Available_;
		this.Quota = Quota_;
	});
	UserAccountMembers = $pkg.UserAccountMembers = $newType(0, $kindStruct, "ninchatapi.UserAccountMembers", "UserAccountMembers", "github.com/ninchat/ninchat-go/ninchatapi", function(Quota_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Quota = 0;
			return;
		}
		this.Quota = Quota_;
	});
	UserAccountObjects = $pkg.UserAccountObjects = $newType(0, $kindStruct, "ninchatapi.UserAccountObjects", "UserAccountObjects", "github.com/ninchat/ninchat-go/ninchatapi", function(Available_, Quota_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Available = 0;
			this.Quota = 0;
			return;
		}
		this.Available = Available_;
		this.Quota = Quota_;
	});
	UserAccountSubscription = $pkg.UserAccountSubscription = $newType(0, $kindStruct, "ninchatapi.UserAccountSubscription", "UserAccountSubscription", "github.com/ninchat/ninchat-go/ninchatapi", function(Active_, Channels_, Expiration_, Plan_, QueueMembers_, Queues_, Realms_, Renewal_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Active = false;
			this.Channels = ptrType$68.nil;
			this.Expiration = ptrType$8.nil;
			this.Plan = "";
			this.QueueMembers = ptrType$69.nil;
			this.Queues = ptrType$68.nil;
			this.Realms = ptrType$68.nil;
			this.Renewal = ptrType$8.nil;
			return;
		}
		this.Active = Active_;
		this.Channels = Channels_;
		this.Expiration = Expiration_;
		this.Plan = Plan_;
		this.QueueMembers = QueueMembers_;
		this.Queues = Queues_;
		this.Realms = Realms_;
		this.Renewal = Renewal_;
	});
	UserChannel = $pkg.UserChannel = $newType(0, $kindStruct, "ninchatapi.UserChannel", "UserChannel", "github.com/ninchat/ninchat-go/ninchatapi", function(ChannelAttrs_, ChannelStatus_, RealmId_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.ChannelAttrs = ptrType$1.nil;
			this.ChannelStatus = ptrType.nil;
			this.RealmId = ptrType.nil;
			return;
		}
		this.ChannelAttrs = ChannelAttrs_;
		this.ChannelStatus = ChannelStatus_;
		this.RealmId = RealmId_;
	});
	UserDialogue = $pkg.UserDialogue = $newType(0, $kindStruct, "ninchatapi.UserDialogue", "UserDialogue", "github.com/ninchat/ninchat-go/ninchatapi", function(AudienceMetadata_, DialogueMembers_, DialogueStatus_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.AudienceMetadata = false;
			this.DialogueMembers = false;
			this.DialogueStatus = ptrType.nil;
			return;
		}
		this.AudienceMetadata = AudienceMetadata_;
		this.DialogueMembers = DialogueMembers_;
		this.DialogueStatus = DialogueStatus_;
	});
	UserQueue = $pkg.UserQueue = $newType(0, $kindStruct, "ninchatapi.UserQueue", "UserQueue", "github.com/ninchat/ninchat-go/ninchatapi", function(QueueAttrs_, RealmId_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.QueueAttrs = ptrType$4.nil;
			this.RealmId = "";
			return;
		}
		this.QueueAttrs = QueueAttrs_;
		this.RealmId = RealmId_;
	});
	UserResult = $pkg.UserResult = $newType(0, $kindStruct, "ninchatapi.UserResult", "UserResult", "github.com/ninchat/ninchat-go/ninchatapi", function(UserAttrs_, Weight_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.UserAttrs = ptrType$3.nil;
			this.Weight = 0;
			return;
		}
		this.UserAttrs = UserAttrs_;
		this.Weight = Weight_;
	});
	ptrType = $ptrType($String);
	ptrType$1 = $ptrType(ChannelAttrs);
	ptrType$2 = $ptrType(RealmAttrs);
	ptrType$3 = $ptrType(UserAttrs);
	ptrType$4 = $ptrType(QueueAttrs);
	ptrType$5 = $ptrType(ChannelMemberAttrs);
	ptrType$6 = $ptrType(PuppetAttrs);
	ptrType$7 = $ptrType(IdentityAttrs);
	ptrType$8 = $ptrType($Int);
	sliceType = $sliceType($String);
	ptrType$9 = $ptrType($Float64);
	sliceType$1 = $sliceType(ninchat.Frame);
	ptrType$10 = $ptrType(QueueMemberAttrs);
	ptrType$11 = $ptrType(QueueTranscript);
	sliceType$2 = $sliceType(ptrType$11);
	ptrType$12 = $ptrType(RealmMemberAttrs);
	ptrType$13 = $ptrType(UserAccount);
	ptrType$14 = $ptrType(TranscriptMessage);
	sliceType$3 = $sliceType(ptrType$14);
	ptrType$15 = $ptrType(ninchat.Event);
	ptrType$16 = $ptrType(ninchat.Session);
	ptrType$17 = $ptrType(ninchat.Action);
	ptrType$18 = $ptrType(DialogueUpdated);
	ptrType$20 = $ptrType(ChannelMemberJoined);
	ptrType$21 = $ptrType(QueueMemberJoined);
	ptrType$22 = $ptrType(RealmMemberJoined);
	ptrType$23 = $ptrType(AccessCreated);
	ptrType$24 = $ptrType(ChannelJoined);
	ptrType$25 = $ptrType(IdentityCreated);
	ptrType$26 = $ptrType(MasterKeyCreated);
	ptrType$27 = $ptrType(QueueCreated);
	ptrType$28 = $ptrType(RealmJoined);
	ptrType$29 = $ptrType(IdentityDeleted);
	ptrType$30 = $ptrType(MasterKeyDeleted);
	ptrType$31 = $ptrType(QueueDeleted);
	ptrType$32 = $ptrType(QueueTranscriptsDeleted);
	ptrType$33 = $ptrType(RealmDeleted);
	ptrType$34 = $ptrType(TranscriptDeleted);
	ptrType$35 = $ptrType(UserDeleted);
	ptrType$36 = $ptrType(AccessFound);
	ptrType$37 = $ptrType(ChannelFound);
	ptrType$38 = $ptrType(IdentityFound);
	ptrType$39 = $ptrType(MasterKeysFound);
	ptrType$40 = $ptrType(QueueFound);
	ptrType$41 = $ptrType(QueueTranscriptsFound);
	ptrType$42 = $ptrType(RealmFound);
	ptrType$43 = $ptrType(RealmQueuesFound);
	ptrType$44 = $ptrType(UserFound);
	ptrType$45 = $ptrType(HistoryDiscarded);
	ptrType$46 = $ptrType(TranscriptContents);
	ptrType$47 = $ptrType(HistoryResults);
	ptrType$48 = $ptrType(ChannelParted);
	ptrType$49 = $ptrType(Pong);
	ptrType$51 = $ptrType(ChannelMemberParted);
	ptrType$52 = $ptrType(QueueMemberParted);
	ptrType$53 = $ptrType(RealmMemberParted);
	mapType = $mapType($String, $emptyInterface);
	ptrType$54 = $ptrType(AudienceEnqueued);
	ptrType$55 = $ptrType(IdentityUpdated);
	ptrType$56 = $ptrType(MessageReceived);
	ptrType$57 = $ptrType(ChannelUpdated);
	ptrType$58 = $ptrType(DialogueMemberAttrs);
	ptrType$60 = $ptrType(ChannelMemberUpdated);
	ptrType$61 = $ptrType(RealmMemberUpdated);
	ptrType$62 = $ptrType(MessageUpdated);
	ptrType$63 = $ptrType(QueueUpdated);
	ptrType$64 = $ptrType(RealmUpdated);
	ptrType$65 = $ptrType(UserUpdated);
	ptrType$66 = $ptrType(UserInfoAttr);
	ptrType$67 = $ptrType(RealmOwnerAccountAttr);
	ptrType$68 = $ptrType(UserAccountObjects);
	ptrType$69 = $ptrType(UserAccountMembers);
	ptrType$70 = $ptrType(RealmThemeAttr);
	sliceType$4 = $sliceType($emptyInterface);
	ptrType$71 = $ptrType(ChannelDeleted);
	ptrType$72 = $ptrType(Error);
	ptrType$73 = $ptrType(QueueJoined);
	ptrType$74 = $ptrType(QueueParted);
	ptrType$75 = $ptrType(RealmParted);
	ptrType$76 = $ptrType(SearchResults);
	ptrType$77 = $ptrType(SessionCreated);
	ptrType$78 = $ptrType(SessionStatusUpdated);
	ptrType$79 = $ptrType(ChannelMember);
	ptrType$80 = $ptrType(ChannelResult);
	structType = $structType([]);
	ptrType$81 = $ptrType(PuppetMaster);
	ptrType$82 = $ptrType(QueueMember);
	ptrType$83 = $ptrType(RealmMember);
	ptrType$84 = $ptrType(RealmQueue);
	ptrType$85 = $ptrType(UserAccountSubscription);
	sliceType$5 = $sliceType(ptrType$85);
	ptrType$86 = $ptrType(UserAccountExtent);
	ptrType$87 = $ptrType(UserChannel);
	ptrType$88 = $ptrType(UserDialogue);
	ptrType$89 = $ptrType(UserQueue);
	ptrType$90 = $ptrType(UserResult);
	ptrType$115 = $ptrType(DescribeUser);
	ptrType$116 = $ptrType(DiscardHistory);
	ptrType$120 = $ptrType(LoadHistory);
	ptrType$133 = $ptrType(UpdateDialogue);
	ptrType$144 = $ptrType(UnexpectedEventError);
	mapType$1 = $mapType($String, ptrType$79);
	mapType$2 = $mapType($String, ptrType$58);
	mapType$3 = $mapType($String, structType);
	mapType$4 = $mapType($String, mapType$3);
	mapType$5 = $mapType($String, ptrType$82);
	mapType$6 = $mapType($String, ptrType$83);
	mapType$7 = $mapType($String, ptrType$84);
	mapType$8 = $mapType($String, ptrType$80);
	mapType$9 = $mapType($String, ptrType$90);
	mapType$10 = $mapType($String, ptrType$81);
	mapType$11 = $mapType($String, ptrType$87);
	mapType$12 = $mapType($String, ptrType$88);
	mapType$13 = $mapType($String, ptrType$7);
	mapType$14 = $mapType($String, mapType$13);
	mapType$15 = $mapType($String, ptrType$89);
	mapType$16 = $mapType($String, ptrType$2);
	mapType$17 = $mapType($String, ptrType$12);
	Call = function(session, events, action) {
		var $ptr, _entry, _r, _r$1, _tuple, _tuple$1, _tuple$2, action, clientAction, err, events, found, session, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _entry = $f._entry; _r = $f._r; _r$1 = $f._r$1; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; _tuple$2 = $f._tuple$2; action = $f.action; clientAction = $f.clientAction; err = $f.err; events = $f.events; found = $f.found; session = $f.session; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		events = [events];
		err = $ifaceNil;
		_r = action.newClientAction(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		clientAction = _tuple[0];
		err = _tuple[1];
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			$close(events[0]);
			return err;
		}
		clientAction.OnReply = (function(events) { return function $b(e) {
			var $ptr, e, $s, $r;
			/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; e = $f.e; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
			/* */ if (e === ptrType$15.nil) { $s = 1; continue; }
			/* */ $s = 2; continue;
			/* if (e === ptrType$15.nil) { */ case 1:
				$close(events[0]);
				$s = 3; continue;
			/* } else { */ case 2:
				$r = $send(events[0], e); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				if (e.LastReply) {
					$close(events[0]);
				}
			/* } */ case 3:
			/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f.e = e; $f.$s = $s; $f.$r = $r; return $f;
		}; })(events);
		/* */ if (session === ptrType$16.nil) { $s = 2; continue; }
		/* */ $s = 3; continue;
		/* if (session === ptrType$16.nil) { */ case 2:
			_r$1 = ninchat.Call(clientAction); /* */ $s = 5; case 5: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			_tuple$1 = _r$1;
			err = _tuple$1[1];
			if (!($interfaceIsEqual(err, $ifaceNil))) {
				$close(events[0]);
				return err;
			}
			$s = 4; continue;
		/* } else { */ case 3:
			_tuple$2 = (_entry = clientAction.Params[$String.keyFor("action_id")], _entry !== undefined ? [_entry.v, true] : [$ifaceNil, false]);
			x = _tuple$2[0];
			found = _tuple$2[1];
			if (found && $interfaceIsEqual(x, $ifaceNil)) {
				$close(events[0]);
				$panic(new $String("calling via session but action_id is disabled"));
			}
			session.Send(clientAction);
		/* } */ case 4:
		return err;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Call }; } $f.$ptr = $ptr; $f._entry = _entry; $f._r = _r; $f._r$1 = _r$1; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f._tuple$2 = _tuple$2; $f.action = action; $f.clientAction = clientAction; $f.err = err; $f.events = events; $f.found = found; $f.session = session; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.Call = Call;
	Send = function(session, action) {
		var $ptr, _r, _tuple, action, clientAction, err, session, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tuple = $f._tuple; action = $f.action; clientAction = $f.clientAction; err = $f.err; session = $f.session; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		err = $ifaceNil;
		_r = action.newClientAction(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		clientAction = _tuple[0];
		err = _tuple[1];
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			return err;
		}
		session.Send(clientAction);
		return err;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Send }; } $f.$ptr = $ptr; $f._r = _r; $f._tuple = _tuple; $f.action = action; $f.clientAction = clientAction; $f.err = err; $f.session = session; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.Send = Send;
	unaryCall = function(session, action, event) {
		var $ptr, _r, _r$1, _r$2, action, c, clientEvent, err, event, ok, session, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; action = $f.action; c = $f.c; clientEvent = $f.clientEvent; err = $f.err; event = $f.event; ok = $f.ok; session = $f.session; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		ok = false;
		err = $ifaceNil;
		c = new $Chan(ptrType$15, 1);
		_r = Call(session, c, action); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		err = _r;
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			return [ok, err];
		}
		_r$1 = $recv(c); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		clientEvent = _r$1[0];
		flush(c);
		if (clientEvent === ptrType$15.nil) {
			return [ok, err];
		}
		ok = true;
		/* */ if (clientEvent.String() === "error") { $s = 3; continue; }
		/* */ $s = 4; continue;
		/* if (clientEvent.String() === "error") { */ case 3:
			err = NewError(clientEvent);
			$s = 5; continue;
		/* } else { */ case 4:
			_r$2 = event.Init(clientEvent); /* */ $s = 6; case 6: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
			err = _r$2;
		/* } */ case 5:
		return [ok, err];
		/* */ } return; } if ($f === undefined) { $f = { $blk: unaryCall }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f.action = action; $f.c = c; $f.clientEvent = clientEvent; $f.err = err; $f.event = event; $f.ok = ok; $f.session = session; $f.$s = $s; $f.$r = $r; return $f;
	};
	flush = function(c) {
		var $ptr, _selection, _tuple, c, open, $r;
		/* */ var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _selection = $f._selection; _tuple = $f._tuple; c = $f.c; open = $f.open; $r = $f.$r; }
		_selection = $select([[c], []]);
		if (_selection[0] === 0) {
			_tuple = _selection[1];
			open = _tuple[1];
			if (!open) {
				return;
			}
		} else if (_selection[0] === 1) {
		}
		$go((function $b() {
			var $ptr, _ok, _r, _ref, _tuple$1, $s, $r;
			/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _ok = $f._ok; _r = $f._r; _ref = $f._ref; _tuple$1 = $f._tuple$1; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
			_ref = c;
			/* while (true) { */ case 1:
				_r = $recv(_ref); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				_tuple$1 = _r;
				_ok = _tuple$1[1];
				if (!_ok) {
					/* break; */ $s = 2; continue;
				}
			/* } */ $s = 1; continue; case 2:
			/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f._ok = _ok; $f._r = _r; $f._ref = _ref; $f._tuple$1 = _tuple$1; $f.$s = $s; $f.$r = $r; return $f;
		}), []);
		/* */ if ($f === undefined) { $f = { $blk: flush }; } $f.$ptr = $ptr; $f._selection = _selection; $f._tuple = _tuple; $f.c = c; $f.open = open; $f.$r = $r; return $f;
	};
	DescribeUser.ptr.prototype.String = function() {
		var $ptr;
		return "describe_user";
	};
	DescribeUser.prototype.String = function() { return this.$val.String(); };
	DescribeUser.ptr.prototype.newClientAction = function() {
		var $ptr, _key, action, clientAction, err, x;
		clientAction = ptrType$17.nil;
		err = $ifaceNil;
		action = this;
		clientAction = new ninchat.Action.ptr($makeMap($String.keyFor, [{ k: "action", v: new $String("describe_user") }]), sliceType$1.nil, $throwNilPointerError, new $Int64(0, 0));
		x = action.UserId;
		if (!(x === ptrType.nil)) {
			_key = "user_id"; (clientAction.Params || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key)] = { k: _key, v: new $String(x.$get()) };
		}
		return [clientAction, err];
	};
	DescribeUser.prototype.newClientAction = function() { return this.$val.newClientAction(); };
	DescribeUser.ptr.prototype.Invoke = function(session) {
		var $ptr, _r, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tuple, action, buf, err, ok, reply, session, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tmp$2 = $f._tmp$2; _tmp$3 = $f._tmp$3; _tmp$4 = $f._tmp$4; _tmp$5 = $f._tmp$5; _tuple = $f._tuple; action = $f.action; buf = $f.buf; err = $f.err; ok = $f.ok; reply = $f.reply; session = $f.session; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		buf = [buf];
		reply = ptrType$44.nil;
		err = $ifaceNil;
		action = this;
		buf[0] = new UserFound.ptr(false, false, ptrType.nil, 0, false, ptrType$13.nil, ptrType$3.nil, false, false, "", false, false, false, false, false);
		_r = unaryCall(session, action, buf[0]); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		ok = _tuple[0];
		err = _tuple[1];
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			_tmp = ptrType$44.nil;
			_tmp$1 = err;
			reply = _tmp;
			err = _tmp$1;
			return [reply, err];
		}
		if (ok) {
			_tmp$2 = buf[0];
			_tmp$3 = $ifaceNil;
			reply = _tmp$2;
			err = _tmp$3;
			return [reply, err];
		}
		_tmp$4 = ptrType$44.nil;
		_tmp$5 = $ifaceNil;
		reply = _tmp$4;
		err = _tmp$5;
		return [reply, err];
		/* */ } return; } if ($f === undefined) { $f = { $blk: DescribeUser.ptr.prototype.Invoke }; } $f.$ptr = $ptr; $f._r = _r; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tmp$2 = _tmp$2; $f._tmp$3 = _tmp$3; $f._tmp$4 = _tmp$4; $f._tmp$5 = _tmp$5; $f._tuple = _tuple; $f.action = action; $f.buf = buf; $f.err = err; $f.ok = ok; $f.reply = reply; $f.session = session; $f.$s = $s; $f.$r = $r; return $f;
	};
	DescribeUser.prototype.Invoke = function(session) { return this.$val.Invoke(session); };
	DiscardHistory.ptr.prototype.String = function() {
		var $ptr;
		return "discard_history";
	};
	DiscardHistory.prototype.String = function() { return this.$val.String(); };
	DiscardHistory.ptr.prototype.newClientAction = function() {
		var $ptr, _key, _key$1, action, clientAction, err, x, x$1;
		clientAction = ptrType$17.nil;
		err = $ifaceNil;
		action = this;
		clientAction = new ninchat.Action.ptr($makeMap($String.keyFor, [{ k: "action", v: new $String("discard_history") }]), sliceType$1.nil, $throwNilPointerError, new $Int64(0, 0));
		x = action.MessageId;
		if (!(x === ptrType.nil)) {
			_key = "message_id"; (clientAction.Params || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key)] = { k: _key, v: new $String(x.$get()) };
		} else {
			err = newRequestMalformedError("discard_history action requires message_id parameter");
			return [clientAction, err];
		}
		x$1 = action.UserId;
		if (!(x$1 === ptrType.nil)) {
			_key$1 = "user_id"; (clientAction.Params || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key$1)] = { k: _key$1, v: new $String(x$1.$get()) };
		} else {
			err = newRequestMalformedError("discard_history action requires user_id parameter");
			return [clientAction, err];
		}
		return [clientAction, err];
	};
	DiscardHistory.prototype.newClientAction = function() { return this.$val.newClientAction(); };
	DiscardHistory.ptr.prototype.Invoke = function(session) {
		var $ptr, _r, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tuple, action, buf, err, ok, reply, session, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tmp$2 = $f._tmp$2; _tmp$3 = $f._tmp$3; _tmp$4 = $f._tmp$4; _tmp$5 = $f._tmp$5; _tuple = $f._tuple; action = $f.action; buf = $f.buf; err = $f.err; ok = $f.ok; reply = $f.reply; session = $f.session; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		buf = [buf];
		reply = ptrType$45.nil;
		err = $ifaceNil;
		action = this;
		buf[0] = new HistoryDiscarded.ptr(ptrType.nil, 0, "", ptrType.nil);
		_r = unaryCall(session, action, buf[0]); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		ok = _tuple[0];
		err = _tuple[1];
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			_tmp = ptrType$45.nil;
			_tmp$1 = err;
			reply = _tmp;
			err = _tmp$1;
			return [reply, err];
		}
		if (ok) {
			_tmp$2 = buf[0];
			_tmp$3 = $ifaceNil;
			reply = _tmp$2;
			err = _tmp$3;
			return [reply, err];
		}
		_tmp$4 = ptrType$45.nil;
		_tmp$5 = $ifaceNil;
		reply = _tmp$4;
		err = _tmp$5;
		return [reply, err];
		/* */ } return; } if ($f === undefined) { $f = { $blk: DiscardHistory.ptr.prototype.Invoke }; } $f.$ptr = $ptr; $f._r = _r; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tmp$2 = _tmp$2; $f._tmp$3 = _tmp$3; $f._tmp$4 = _tmp$4; $f._tmp$5 = _tmp$5; $f._tuple = _tuple; $f.action = action; $f.buf = buf; $f.err = err; $f.ok = ok; $f.reply = reply; $f.session = session; $f.$s = $s; $f.$r = $r; return $f;
	};
	DiscardHistory.prototype.Invoke = function(session) { return this.$val.Invoke(session); };
	LoadHistory.ptr.prototype.String = function() {
		var $ptr;
		return "load_history";
	};
	LoadHistory.prototype.String = function() { return this.$val.String(); };
	LoadHistory.ptr.prototype.newClientAction = function() {
		var $ptr, _key, _key$1, _key$2, _key$3, _key$4, _key$5, _key$6, _key$7, action, clientAction, err, x, x$1, x$2, x$3, x$4, x$5, x$6, x$7;
		clientAction = ptrType$17.nil;
		err = $ifaceNil;
		action = this;
		clientAction = new ninchat.Action.ptr($makeMap($String.keyFor, [{ k: "action", v: new $String("load_history") }]), sliceType$1.nil, $throwNilPointerError, new $Int64(0, 0));
		x = action.ChannelId;
		if (!(x === ptrType.nil)) {
			_key = "channel_id"; (clientAction.Params || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key)] = { k: _key, v: new $String(x.$get()) };
		}
		x$1 = action.FilterProperty;
		if (!(x$1 === ptrType.nil)) {
			_key$1 = "filter_property"; (clientAction.Params || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key$1)] = { k: _key$1, v: new $String(x$1.$get()) };
		}
		x$2 = action.FilterSubstring;
		if (!(x$2 === ptrType.nil)) {
			_key$2 = "filter_substring"; (clientAction.Params || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key$2)] = { k: _key$2, v: new $String(x$2.$get()) };
		}
		x$3 = action.HistoryLength;
		if (!(x$3 === ptrType$8.nil)) {
			_key$3 = "history_length"; (clientAction.Params || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key$3)] = { k: _key$3, v: new $Int(x$3.$get()) };
		}
		x$4 = action.HistoryOrder;
		if (!(x$4 === ptrType$8.nil)) {
			_key$4 = "history_order"; (clientAction.Params || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key$4)] = { k: _key$4, v: new $Int(x$4.$get()) };
		}
		x$5 = action.MessageId;
		if (!(x$5 === ptrType.nil)) {
			_key$5 = "message_id"; (clientAction.Params || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key$5)] = { k: _key$5, v: new $String(x$5.$get()) };
		}
		x$6 = action.MessageTypes;
		if (!(x$6 === sliceType.nil)) {
			_key$6 = "message_types"; (clientAction.Params || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key$6)] = { k: _key$6, v: x$6 };
		}
		x$7 = action.UserId;
		if (!(x$7 === ptrType.nil)) {
			_key$7 = "user_id"; (clientAction.Params || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key$7)] = { k: _key$7, v: new $String(x$7.$get()) };
		}
		return [clientAction, err];
	};
	LoadHistory.prototype.newClientAction = function() { return this.$val.newClientAction(); };
	LoadHistory.ptr.prototype.Invoke = function(session) {
		var $ptr, _r, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tuple, action, buf, err, ok, reply, session, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tmp$2 = $f._tmp$2; _tmp$3 = $f._tmp$3; _tmp$4 = $f._tmp$4; _tmp$5 = $f._tmp$5; _tuple = $f._tuple; action = $f.action; buf = $f.buf; err = $f.err; ok = $f.ok; reply = $f.reply; session = $f.session; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		buf = [buf];
		reply = ptrType$47.nil;
		err = $ifaceNil;
		action = this;
		buf[0] = new HistoryResults.ptr(ptrType.nil, 0, 0, ptrType.nil, ptrType.nil);
		_r = unaryCall(session, action, buf[0]); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		ok = _tuple[0];
		err = _tuple[1];
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			_tmp = ptrType$47.nil;
			_tmp$1 = err;
			reply = _tmp;
			err = _tmp$1;
			return [reply, err];
		}
		if (ok) {
			_tmp$2 = buf[0];
			_tmp$3 = $ifaceNil;
			reply = _tmp$2;
			err = _tmp$3;
			return [reply, err];
		}
		_tmp$4 = ptrType$47.nil;
		_tmp$5 = $ifaceNil;
		reply = _tmp$4;
		err = _tmp$5;
		return [reply, err];
		/* */ } return; } if ($f === undefined) { $f = { $blk: LoadHistory.ptr.prototype.Invoke }; } $f.$ptr = $ptr; $f._r = _r; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tmp$2 = _tmp$2; $f._tmp$3 = _tmp$3; $f._tmp$4 = _tmp$4; $f._tmp$5 = _tmp$5; $f._tuple = _tuple; $f.action = action; $f.buf = buf; $f.err = err; $f.ok = ok; $f.reply = reply; $f.session = session; $f.$s = $s; $f.$r = $r; return $f;
	};
	LoadHistory.prototype.Invoke = function(session) { return this.$val.Invoke(session); };
	UpdateDialogue.ptr.prototype.String = function() {
		var $ptr;
		return "update_dialogue";
	};
	UpdateDialogue.prototype.String = function() { return this.$val.String(); };
	UpdateDialogue.ptr.prototype.newClientAction = function() {
		var $ptr, _key, _key$1, _key$2, action, clientAction, err, x, x$1, x$2;
		clientAction = ptrType$17.nil;
		err = $ifaceNil;
		action = this;
		clientAction = new ninchat.Action.ptr($makeMap($String.keyFor, [{ k: "action", v: new $String("update_dialogue") }]), sliceType$1.nil, $throwNilPointerError, new $Int64(0, 0));
		x = action.DialogueStatus;
		if (!(x === ptrType.nil)) {
			_key = "dialogue_status"; (clientAction.Params || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key)] = { k: _key, v: new $String(x.$get()) };
		}
		x$1 = action.MemberAttrs;
		if (!(x$1 === ptrType$58.nil)) {
			_key$1 = "member_attrs"; (clientAction.Params || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key$1)] = { k: _key$1, v: x$1 };
		}
		x$2 = action.UserId;
		if (!(x$2 === ptrType.nil)) {
			_key$2 = "user_id"; (clientAction.Params || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key$2)] = { k: _key$2, v: new $String(x$2.$get()) };
		} else {
			err = newRequestMalformedError("update_dialogue action requires user_id parameter");
			return [clientAction, err];
		}
		return [clientAction, err];
	};
	UpdateDialogue.prototype.newClientAction = function() { return this.$val.newClientAction(); };
	UpdateDialogue.ptr.prototype.Invoke = function(session) {
		var $ptr, _r, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tuple, action, buf, err, ok, reply, session, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tmp$2 = $f._tmp$2; _tmp$3 = $f._tmp$3; _tmp$4 = $f._tmp$4; _tmp$5 = $f._tmp$5; _tuple = $f._tuple; action = $f.action; buf = $f.buf; err = $f.err; ok = $f.ok; reply = $f.reply; session = $f.session; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		buf = [buf];
		reply = ptrType$18.nil;
		err = $ifaceNil;
		action = this;
		buf[0] = new DialogueUpdated.ptr(false, false, ptrType.nil, 0, "");
		_r = unaryCall(session, action, buf[0]); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		ok = _tuple[0];
		err = _tuple[1];
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			_tmp = ptrType$18.nil;
			_tmp$1 = err;
			reply = _tmp;
			err = _tmp$1;
			return [reply, err];
		}
		if (ok) {
			_tmp$2 = buf[0];
			_tmp$3 = $ifaceNil;
			reply = _tmp$2;
			err = _tmp$3;
			return [reply, err];
		}
		_tmp$4 = ptrType$18.nil;
		_tmp$5 = $ifaceNil;
		reply = _tmp$4;
		err = _tmp$5;
		return [reply, err];
		/* */ } return; } if ($f === undefined) { $f = { $blk: UpdateDialogue.ptr.prototype.Invoke }; } $f.$ptr = $ptr; $f._r = _r; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tmp$2 = _tmp$2; $f._tmp$3 = _tmp$3; $f._tmp$4 = _tmp$4; $f._tmp$5 = _tmp$5; $f._tuple = _tuple; $f.action = action; $f.buf = buf; $f.err = err; $f.ok = ok; $f.reply = reply; $f.session = session; $f.$s = $s; $f.$r = $r; return $f;
	};
	UpdateDialogue.prototype.Invoke = function(session) { return this.$val.Invoke(session); };
	NewUserInfoAttr = function(source) {
		var $ptr, _entry, _entry$1, _tuple, _tuple$1, ok, ok$1, source, target, x, x$1, y, y$1, y$24ptr, y$24ptr$1;
		target = ptrType$66.nil;
		target = new UserInfoAttr.ptr(ptrType.nil, ptrType.nil);
		x = (_entry = source[$String.keyFor("company")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, $String, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.Company = (y$24ptr || (y$24ptr = new ptrType(function() { return y; }, function($v) { y = $v; })));
			}
		}
		x$1 = (_entry$1 = source[$String.keyFor("url")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			_tuple$1 = $assertType(x$1, $String, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.Url = (y$24ptr$1 || (y$24ptr$1 = new ptrType(function() { return y$1; }, function($v) { y$1 = $v; })));
			}
		}
		return target;
	};
	$pkg.NewUserInfoAttr = NewUserInfoAttr;
	NewRealmOwnerAccountAttr = function(source) {
		var $ptr, _entry, _entry$1, _entry$2, _tuple, _tuple$1, _tuple$2, ok, ok$1, ok$2, source, target, x, x$1, x$2, y, y$1, y$2;
		target = ptrType$67.nil;
		target = new RealmOwnerAccountAttr.ptr(ptrType$68.nil, ptrType$69.nil, ptrType$68.nil);
		x = (_entry = source[$String.keyFor("channels")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, mapType, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.Channels = NewUserAccountObjects(y);
			}
		}
		x$1 = (_entry$1 = source[$String.keyFor("queue_members")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			_tuple$1 = $assertType(x$1, mapType, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.QueueMembers = NewUserAccountMembers(y$1);
			}
		}
		x$2 = (_entry$2 = source[$String.keyFor("queues")], _entry$2 !== undefined ? _entry$2.v : $ifaceNil);
		if (!($interfaceIsEqual(x$2, $ifaceNil))) {
			_tuple$2 = $assertType(x$2, mapType, true);
			y$2 = _tuple$2[0];
			ok$2 = _tuple$2[1];
			if (ok$2) {
				target.Queues = NewUserAccountObjects(y$2);
			}
		}
		return target;
	};
	$pkg.NewRealmOwnerAccountAttr = NewRealmOwnerAccountAttr;
	NewRealmThemeAttr = function(source) {
		var $ptr, _entry, _tuple, ok, source, target, x, y, y$24ptr;
		target = ptrType$70.nil;
		target = new RealmThemeAttr.ptr(ptrType.nil);
		x = (_entry = source[$String.keyFor("color")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, $String, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.Color = (y$24ptr || (y$24ptr = new ptrType(function() { return y; }, function($v) { y = $v; })));
			}
		}
		return target;
	};
	$pkg.NewRealmThemeAttr = NewRealmThemeAttr;
	NewChannelAttrs = function(source) {
		var $ptr, source, target;
		target = ptrType$1.nil;
		target = new ChannelAttrs.ptr(false, false, sliceType.nil, false, ptrType$8.nil, false, ptrType.nil, ptrType.nil, false, false, ptrType.nil, false, ptrType.nil, ptrType.nil, false);
		target.Init(source);
		return target;
	};
	$pkg.NewChannelAttrs = NewChannelAttrs;
	ChannelAttrs.ptr.prototype.Init = function(source) {
		var $ptr, _entry, _entry$1, _entry$10, _entry$11, _entry$12, _entry$13, _entry$14, _entry$2, _entry$3, _entry$4, _entry$5, _entry$6, _entry$7, _entry$8, _entry$9, _tuple, _tuple$1, _tuple$2, _tuple$3, _tuple$4, _tuple$5, _tuple$6, ok, ok$1, ok$2, ok$3, ok$4, ok$5, ok$6, source, target, x, x$1, x$10, x$11, x$12, x$13, x$14, x$2, x$3, x$4, x$5, x$6, x$7, x$8, x$9, y, y$1, y$2, y$24ptr, y$24ptr$1, y$24ptr$2, y$24ptr$3, y$24ptr$4, y$24ptr$5, y$3, y$4, y$5, y$6;
		target = this;
		x = (_entry = source[$String.keyFor("autohide")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			target.Autohide = true;
		}
		x$1 = (_entry$1 = source[$String.keyFor("autosilence")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			target.Autosilence = true;
		}
		x$2 = (_entry$2 = source[$String.keyFor("blacklisted_message_types")], _entry$2 !== undefined ? _entry$2.v : $ifaceNil);
		if (!($interfaceIsEqual(x$2, $ifaceNil))) {
			_tuple = $assertType(x$2, sliceType$4, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.BlacklistedMessageTypes = AppendStrings(sliceType.nil, y);
			}
		}
		x$3 = (_entry$3 = source[$String.keyFor("closed")], _entry$3 !== undefined ? _entry$3.v : $ifaceNil);
		if (!($interfaceIsEqual(x$3, $ifaceNil))) {
			target.Closed = true;
		}
		x$4 = (_entry$4 = source[$String.keyFor("disclosed_since")], _entry$4 !== undefined ? _entry$4.v : $ifaceNil);
		if (!($interfaceIsEqual(x$4, $ifaceNil))) {
			_tuple$1 = $assertType(x$4, $Int, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.DisclosedSince = (y$24ptr || (y$24ptr = new ptrType$8(function() { return y$1; }, function($v) { y$1 = $v; })));
			}
		}
		x$5 = (_entry$5 = source[$String.keyFor("followable")], _entry$5 !== undefined ? _entry$5.v : $ifaceNil);
		if (!($interfaceIsEqual(x$5, $ifaceNil))) {
			target.Followable = true;
		}
		x$6 = (_entry$6 = source[$String.keyFor("name")], _entry$6 !== undefined ? _entry$6.v : $ifaceNil);
		if (!($interfaceIsEqual(x$6, $ifaceNil))) {
			_tuple$2 = $assertType(x$6, $String, true);
			y$2 = _tuple$2[0];
			ok$2 = _tuple$2[1];
			if (ok$2) {
				target.Name = (y$24ptr$1 || (y$24ptr$1 = new ptrType(function() { return y$2; }, function($v) { y$2 = $v; })));
			}
		}
		x$7 = (_entry$7 = source[$String.keyFor("owner_id")], _entry$7 !== undefined ? _entry$7.v : $ifaceNil);
		if (!($interfaceIsEqual(x$7, $ifaceNil))) {
			_tuple$3 = $assertType(x$7, $String, true);
			y$3 = _tuple$3[0];
			ok$3 = _tuple$3[1];
			if (ok$3) {
				target.OwnerId = (y$24ptr$2 || (y$24ptr$2 = new ptrType(function() { return y$3; }, function($v) { y$3 = $v; })));
			}
		}
		x$8 = (_entry$8 = source[$String.keyFor("private")], _entry$8 !== undefined ? _entry$8.v : $ifaceNil);
		if (!($interfaceIsEqual(x$8, $ifaceNil))) {
			target.Private = true;
		}
		x$9 = (_entry$9 = source[$String.keyFor("public")], _entry$9 !== undefined ? _entry$9.v : $ifaceNil);
		if (!($interfaceIsEqual(x$9, $ifaceNil))) {
			target.Public = true;
		}
		x$10 = (_entry$10 = source[$String.keyFor("ratelimit")], _entry$10 !== undefined ? _entry$10.v : $ifaceNil);
		if (!($interfaceIsEqual(x$10, $ifaceNil))) {
			_tuple$4 = $assertType(x$10, $String, true);
			y$4 = _tuple$4[0];
			ok$4 = _tuple$4[1];
			if (ok$4) {
				target.Ratelimit = (y$24ptr$3 || (y$24ptr$3 = new ptrType(function() { return y$4; }, function($v) { y$4 = $v; })));
			}
		}
		x$11 = (_entry$11 = source[$String.keyFor("suspended")], _entry$11 !== undefined ? _entry$11.v : $ifaceNil);
		if (!($interfaceIsEqual(x$11, $ifaceNil))) {
			target.Suspended = true;
		}
		x$12 = (_entry$12 = source[$String.keyFor("topic")], _entry$12 !== undefined ? _entry$12.v : $ifaceNil);
		if (!($interfaceIsEqual(x$12, $ifaceNil))) {
			_tuple$5 = $assertType(x$12, $String, true);
			y$5 = _tuple$5[0];
			ok$5 = _tuple$5[1];
			if (ok$5) {
				target.Topic = (y$24ptr$4 || (y$24ptr$4 = new ptrType(function() { return y$5; }, function($v) { y$5 = $v; })));
			}
		}
		x$13 = (_entry$13 = source[$String.keyFor("upload")], _entry$13 !== undefined ? _entry$13.v : $ifaceNil);
		if (!($interfaceIsEqual(x$13, $ifaceNil))) {
			_tuple$6 = $assertType(x$13, $String, true);
			y$6 = _tuple$6[0];
			ok$6 = _tuple$6[1];
			if (ok$6) {
				target.Upload = (y$24ptr$5 || (y$24ptr$5 = new ptrType(function() { return y$6; }, function($v) { y$6 = $v; })));
			}
		}
		x$14 = (_entry$14 = source[$String.keyFor("verified_join")], _entry$14 !== undefined ? _entry$14.v : $ifaceNil);
		if (!($interfaceIsEqual(x$14, $ifaceNil))) {
			target.VerifiedJoin = true;
		}
	};
	ChannelAttrs.prototype.Init = function(source) { return this.$val.Init(source); };
	NewChannelMemberAttrs = function(source) {
		var $ptr, source, target;
		target = ptrType$5.nil;
		target = new ChannelMemberAttrs.ptr(false, false, false, false, ptrType$8.nil);
		target.Init(source);
		return target;
	};
	$pkg.NewChannelMemberAttrs = NewChannelMemberAttrs;
	ChannelMemberAttrs.ptr.prototype.Init = function(source) {
		var $ptr, _entry, _entry$1, _entry$2, _entry$3, _entry$4, _tuple, ok, source, target, x, x$1, x$2, x$3, x$4, y, y$24ptr;
		target = this;
		x = (_entry = source[$String.keyFor("autohide")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			target.Autohide = true;
		}
		x$1 = (_entry$1 = source[$String.keyFor("moderator")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			target.Moderator = true;
		}
		x$2 = (_entry$2 = source[$String.keyFor("operator")], _entry$2 !== undefined ? _entry$2.v : $ifaceNil);
		if (!($interfaceIsEqual(x$2, $ifaceNil))) {
			target.Operator = true;
		}
		x$3 = (_entry$3 = source[$String.keyFor("silenced")], _entry$3 !== undefined ? _entry$3.v : $ifaceNil);
		if (!($interfaceIsEqual(x$3, $ifaceNil))) {
			target.Silenced = true;
		}
		x$4 = (_entry$4 = source[$String.keyFor("since")], _entry$4 !== undefined ? _entry$4.v : $ifaceNil);
		if (!($interfaceIsEqual(x$4, $ifaceNil))) {
			_tuple = $assertType(x$4, $Int, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.Since = (y$24ptr || (y$24ptr = new ptrType$8(function() { return y; }, function($v) { y = $v; })));
			}
		}
	};
	ChannelMemberAttrs.prototype.Init = function(source) { return this.$val.Init(source); };
	NewDialogueMemberAttrs = function(source) {
		var $ptr, source, target;
		target = ptrType$58.nil;
		target = new DialogueMemberAttrs.ptr(false, ptrType.nil, ptrType$8.nil, false);
		target.Init(source);
		return target;
	};
	$pkg.NewDialogueMemberAttrs = NewDialogueMemberAttrs;
	DialogueMemberAttrs.ptr.prototype.Init = function(source) {
		var $ptr, _entry, _entry$1, _entry$2, _entry$3, _tuple, _tuple$1, ok, ok$1, source, target, x, x$1, x$2, x$3, y, y$1, y$24ptr, y$24ptr$1;
		target = this;
		x = (_entry = source[$String.keyFor("audience_ended")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			target.AudienceEnded = true;
		}
		x$1 = (_entry$1 = source[$String.keyFor("queue_id")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			_tuple = $assertType(x$1, $String, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.QueueId = (y$24ptr || (y$24ptr = new ptrType(function() { return y; }, function($v) { y = $v; })));
			}
		}
		x$2 = (_entry$2 = source[$String.keyFor("rating")], _entry$2 !== undefined ? _entry$2.v : $ifaceNil);
		if (!($interfaceIsEqual(x$2, $ifaceNil))) {
			_tuple$1 = $assertType(x$2, $Int, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.Rating = (y$24ptr$1 || (y$24ptr$1 = new ptrType$8(function() { return y$1; }, function($v) { y$1 = $v; })));
			}
		}
		x$3 = (_entry$3 = source[$String.keyFor("writing")], _entry$3 !== undefined ? _entry$3.v : $ifaceNil);
		if (!($interfaceIsEqual(x$3, $ifaceNil))) {
			target.Writing = true;
		}
	};
	DialogueMemberAttrs.prototype.Init = function(source) { return this.$val.Init(source); };
	NewIdentityAttrs = function(source) {
		var $ptr, source, target;
		target = ptrType$7.nil;
		target = new IdentityAttrs.ptr(false, false, false, false, false);
		target.Init(source);
		return target;
	};
	$pkg.NewIdentityAttrs = NewIdentityAttrs;
	IdentityAttrs.ptr.prototype.Init = function(source) {
		var $ptr, _entry, _entry$1, _entry$2, _entry$3, _entry$4, source, target, x, x$1, x$2, x$3, x$4;
		target = this;
		x = (_entry = source[$String.keyFor("auth")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			target.Auth = true;
		}
		x$1 = (_entry$1 = source[$String.keyFor("blocked")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			target.Blocked = true;
		}
		x$2 = (_entry$2 = source[$String.keyFor("pending")], _entry$2 !== undefined ? _entry$2.v : $ifaceNil);
		if (!($interfaceIsEqual(x$2, $ifaceNil))) {
			target.Pending = true;
		}
		x$3 = (_entry$3 = source[$String.keyFor("public")], _entry$3 !== undefined ? _entry$3.v : $ifaceNil);
		if (!($interfaceIsEqual(x$3, $ifaceNil))) {
			target.Public = true;
		}
		x$4 = (_entry$4 = source[$String.keyFor("rejected")], _entry$4 !== undefined ? _entry$4.v : $ifaceNil);
		if (!($interfaceIsEqual(x$4, $ifaceNil))) {
			target.Rejected = true;
		}
	};
	IdentityAttrs.prototype.Init = function(source) { return this.$val.Init(source); };
	NewPuppetAttrs = function(source) {
		var $ptr, source, target;
		target = ptrType$6.nil;
		target = new PuppetAttrs.ptr(ptrType.nil);
		target.Init(source);
		return target;
	};
	$pkg.NewPuppetAttrs = NewPuppetAttrs;
	PuppetAttrs.ptr.prototype.Init = function(source) {
		var $ptr, _entry, _tuple, ok, source, target, x, y, y$24ptr;
		target = this;
		x = (_entry = source[$String.keyFor("name")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, $String, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.Name = (y$24ptr || (y$24ptr = new ptrType(function() { return y; }, function($v) { y = $v; })));
			}
		}
	};
	PuppetAttrs.prototype.Init = function(source) { return this.$val.Init(source); };
	NewQueueAttrs = function(source) {
		var $ptr, source, target;
		target = ptrType$4.nil;
		target = new QueueAttrs.ptr(ptrType$8.nil, false, ptrType$8.nil, ptrType.nil, false, ptrType.nil);
		target.Init(source);
		return target;
	};
	$pkg.NewQueueAttrs = NewQueueAttrs;
	QueueAttrs.ptr.prototype.Init = function(source) {
		var $ptr, _entry, _entry$1, _entry$2, _entry$3, _entry$4, _entry$5, _tuple, _tuple$1, _tuple$2, _tuple$3, ok, ok$1, ok$2, ok$3, source, target, x, x$1, x$2, x$3, x$4, x$5, y, y$1, y$2, y$24ptr, y$24ptr$1, y$24ptr$2, y$24ptr$3, y$3;
		target = this;
		x = (_entry = source[$String.keyFor("capacity")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, $Int, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.Capacity = (y$24ptr || (y$24ptr = new ptrType$8(function() { return y; }, function($v) { y = $v; })));
			}
		}
		x$1 = (_entry$1 = source[$String.keyFor("closed")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			target.Closed = true;
		}
		x$2 = (_entry$2 = source[$String.keyFor("length")], _entry$2 !== undefined ? _entry$2.v : $ifaceNil);
		if (!($interfaceIsEqual(x$2, $ifaceNil))) {
			_tuple$1 = $assertType(x$2, $Int, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.Length = (y$24ptr$1 || (y$24ptr$1 = new ptrType$8(function() { return y$1; }, function($v) { y$1 = $v; })));
			}
		}
		x$3 = (_entry$3 = source[$String.keyFor("name")], _entry$3 !== undefined ? _entry$3.v : $ifaceNil);
		if (!($interfaceIsEqual(x$3, $ifaceNil))) {
			_tuple$2 = $assertType(x$3, $String, true);
			y$2 = _tuple$2[0];
			ok$2 = _tuple$2[1];
			if (ok$2) {
				target.Name = (y$24ptr$2 || (y$24ptr$2 = new ptrType(function() { return y$2; }, function($v) { y$2 = $v; })));
			}
		}
		x$4 = (_entry$4 = source[$String.keyFor("suspended")], _entry$4 !== undefined ? _entry$4.v : $ifaceNil);
		if (!($interfaceIsEqual(x$4, $ifaceNil))) {
			target.Suspended = true;
		}
		x$5 = (_entry$5 = source[$String.keyFor("upload")], _entry$5 !== undefined ? _entry$5.v : $ifaceNil);
		if (!($interfaceIsEqual(x$5, $ifaceNil))) {
			_tuple$3 = $assertType(x$5, $String, true);
			y$3 = _tuple$3[0];
			ok$3 = _tuple$3[1];
			if (ok$3) {
				target.Upload = (y$24ptr$3 || (y$24ptr$3 = new ptrType(function() { return y$3; }, function($v) { y$3 = $v; })));
			}
		}
	};
	QueueAttrs.prototype.Init = function(source) { return this.$val.Init(source); };
	NewQueueMemberAttrs = function(source) {
		var $ptr, source, target;
		target = ptrType$10.nil;
		target = new QueueMemberAttrs.ptr();
		target.Init(source);
		return target;
	};
	$pkg.NewQueueMemberAttrs = NewQueueMemberAttrs;
	QueueMemberAttrs.ptr.prototype.Init = function(source) {
		var $ptr, source, target;
		target = this;
	};
	QueueMemberAttrs.prototype.Init = function(source) { return this.$val.Init(source); };
	NewRealmAttrs = function(source) {
		var $ptr, source, target;
		target = ptrType$2.nil;
		target = new RealmAttrs.ptr(ptrType.nil, ptrType$67.nil, ptrType.nil, false, ptrType$70.nil);
		target.Init(source);
		return target;
	};
	$pkg.NewRealmAttrs = NewRealmAttrs;
	RealmAttrs.ptr.prototype.Init = function(source) {
		var $ptr, _entry, _entry$1, _entry$2, _entry$3, _entry$4, _tuple, _tuple$1, _tuple$2, _tuple$3, ok, ok$1, ok$2, ok$3, source, target, x, x$1, x$2, x$3, x$4, y, y$1, y$2, y$24ptr, y$24ptr$1, y$3;
		target = this;
		x = (_entry = source[$String.keyFor("name")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, $String, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.Name = (y$24ptr || (y$24ptr = new ptrType(function() { return y; }, function($v) { y = $v; })));
			}
		}
		x$1 = (_entry$1 = source[$String.keyFor("owner_account")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			_tuple$1 = $assertType(x$1, mapType, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.OwnerAccount = NewRealmOwnerAccountAttr(y$1);
			}
		}
		x$2 = (_entry$2 = source[$String.keyFor("owner_id")], _entry$2 !== undefined ? _entry$2.v : $ifaceNil);
		if (!($interfaceIsEqual(x$2, $ifaceNil))) {
			_tuple$2 = $assertType(x$2, $String, true);
			y$2 = _tuple$2[0];
			ok$2 = _tuple$2[1];
			if (ok$2) {
				target.OwnerId = (y$24ptr$1 || (y$24ptr$1 = new ptrType(function() { return y$2; }, function($v) { y$2 = $v; })));
			}
		}
		x$3 = (_entry$3 = source[$String.keyFor("suspended")], _entry$3 !== undefined ? _entry$3.v : $ifaceNil);
		if (!($interfaceIsEqual(x$3, $ifaceNil))) {
			target.Suspended = true;
		}
		x$4 = (_entry$4 = source[$String.keyFor("theme")], _entry$4 !== undefined ? _entry$4.v : $ifaceNil);
		if (!($interfaceIsEqual(x$4, $ifaceNil))) {
			_tuple$3 = $assertType(x$4, mapType, true);
			y$3 = _tuple$3[0];
			ok$3 = _tuple$3[1];
			if (ok$3) {
				target.Theme = NewRealmThemeAttr(y$3);
			}
		}
	};
	RealmAttrs.prototype.Init = function(source) { return this.$val.Init(source); };
	NewRealmMemberAttrs = function(source) {
		var $ptr, source, target;
		target = ptrType$12.nil;
		target = new RealmMemberAttrs.ptr(false);
		target.Init(source);
		return target;
	};
	$pkg.NewRealmMemberAttrs = NewRealmMemberAttrs;
	RealmMemberAttrs.ptr.prototype.Init = function(source) {
		var $ptr, _entry, source, target, x;
		target = this;
		x = (_entry = source[$String.keyFor("operator")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			target.Operator = true;
		}
	};
	RealmMemberAttrs.prototype.Init = function(source) { return this.$val.Init(source); };
	NewUserAttrs = function(source) {
		var $ptr, source, target;
		target = ptrType$3.nil;
		target = new UserAttrs.ptr(false, false, false, false, ptrType.nil, ptrType$8.nil, ptrType$66.nil, ptrType.nil, ptrType.nil);
		target.Init(source);
		return target;
	};
	$pkg.NewUserAttrs = NewUserAttrs;
	UserAttrs.ptr.prototype.Init = function(source) {
		var $ptr, _entry, _entry$1, _entry$2, _entry$3, _entry$4, _entry$5, _entry$6, _entry$7, _entry$8, _tuple, _tuple$1, _tuple$2, _tuple$3, _tuple$4, ok, ok$1, ok$2, ok$3, ok$4, source, target, x, x$1, x$2, x$3, x$4, x$5, x$6, x$7, x$8, y, y$1, y$2, y$24ptr, y$24ptr$1, y$24ptr$2, y$24ptr$3, y$3, y$4;
		target = this;
		x = (_entry = source[$String.keyFor("admin")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			target.Admin = true;
		}
		x$1 = (_entry$1 = source[$String.keyFor("connected")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			target.Connected = true;
		}
		x$2 = (_entry$2 = source[$String.keyFor("deleted")], _entry$2 !== undefined ? _entry$2.v : $ifaceNil);
		if (!($interfaceIsEqual(x$2, $ifaceNil))) {
			target.Deleted = true;
		}
		x$3 = (_entry$3 = source[$String.keyFor("guest")], _entry$3 !== undefined ? _entry$3.v : $ifaceNil);
		if (!($interfaceIsEqual(x$3, $ifaceNil))) {
			target.Guest = true;
		}
		x$4 = (_entry$4 = source[$String.keyFor("iconurl")], _entry$4 !== undefined ? _entry$4.v : $ifaceNil);
		if (!($interfaceIsEqual(x$4, $ifaceNil))) {
			_tuple = $assertType(x$4, $String, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.Iconurl = (y$24ptr || (y$24ptr = new ptrType(function() { return y; }, function($v) { y = $v; })));
			}
		}
		x$5 = (_entry$5 = source[$String.keyFor("idle")], _entry$5 !== undefined ? _entry$5.v : $ifaceNil);
		if (!($interfaceIsEqual(x$5, $ifaceNil))) {
			_tuple$1 = $assertType(x$5, $Int, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.Idle = (y$24ptr$1 || (y$24ptr$1 = new ptrType$8(function() { return y$1; }, function($v) { y$1 = $v; })));
			}
		}
		x$6 = (_entry$6 = source[$String.keyFor("info")], _entry$6 !== undefined ? _entry$6.v : $ifaceNil);
		if (!($interfaceIsEqual(x$6, $ifaceNil))) {
			_tuple$2 = $assertType(x$6, mapType, true);
			y$2 = _tuple$2[0];
			ok$2 = _tuple$2[1];
			if (ok$2) {
				target.Info = NewUserInfoAttr(y$2);
			}
		}
		x$7 = (_entry$7 = source[$String.keyFor("name")], _entry$7 !== undefined ? _entry$7.v : $ifaceNil);
		if (!($interfaceIsEqual(x$7, $ifaceNil))) {
			_tuple$3 = $assertType(x$7, $String, true);
			y$3 = _tuple$3[0];
			ok$3 = _tuple$3[1];
			if (ok$3) {
				target.Name = (y$24ptr$2 || (y$24ptr$2 = new ptrType(function() { return y$3; }, function($v) { y$3 = $v; })));
			}
		}
		x$8 = (_entry$8 = source[$String.keyFor("realname")], _entry$8 !== undefined ? _entry$8.v : $ifaceNil);
		if (!($interfaceIsEqual(x$8, $ifaceNil))) {
			_tuple$4 = $assertType(x$8, $String, true);
			y$4 = _tuple$4[0];
			ok$4 = _tuple$4[1];
			if (ok$4) {
				target.Realname = (y$24ptr$3 || (y$24ptr$3 = new ptrType(function() { return y$4; }, function($v) { y$4 = $v; })));
			}
		}
	};
	UserAttrs.prototype.Init = function(source) { return this.$val.Init(source); };
	Error.ptr.prototype.Error = function() {
		var $ptr, event, s;
		s = "";
		event = this;
		s = event.ErrorType;
		if (!(event.ErrorReason === ptrType.nil)) {
			s = s + (": " + event.ErrorReason.$get());
		}
		return s;
	};
	Error.prototype.Error = function() { return this.$val.Error(); };
	newRequestMalformedError = function(reason) {
		var $ptr, reason, reason$24ptr;
		return new Error.ptr(ptrType.nil, (reason$24ptr || (reason$24ptr = new ptrType(function() { return reason; }, function($v) { reason = $v; }))), "request_malformed", 0, ptrType.nil, ptrType.nil, ptrType.nil, ptrType.nil, ptrType.nil, ptrType.nil);
	};
	UnexpectedEventError.ptr.prototype.Error = function() {
		var $ptr, e;
		e = this;
		return "unexpected event type: " + e.Event.String();
	};
	UnexpectedEventError.prototype.Error = function() { return this.$val.Error(); };
	UnexpectedEventError.ptr.prototype.String = function() {
		var $ptr, e;
		e = this;
		return e.Error();
	};
	UnexpectedEventError.prototype.String = function() { return this.$val.String(); };
	NewEvent = function(clientEvent) {
		var $ptr, _entry, _r, _r$1, clientEvent, err, event, f, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _entry = $f._entry; _r = $f._r; _r$1 = $f._r$1; clientEvent = $f.clientEvent; err = $f.err; event = $f.event; f = $f.f; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		event = $ifaceNil;
		err = $ifaceNil;
		/* */ if (!(clientEvent === ptrType$15.nil)) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!(clientEvent === ptrType$15.nil)) { */ case 1:
			f = (_entry = $pkg.EventFactories[$String.keyFor(clientEvent.String())], _entry !== undefined ? _entry.v : $throwNilPointerError);
			/* */ if (!(f === $throwNilPointerError)) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (!(f === $throwNilPointerError)) { */ case 3:
				_r = f(); /* */ $s = 6; case 6: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				event = _r;
				_r$1 = event.Init(clientEvent); /* */ $s = 7; case 7: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
				_r$1;
				$s = 5; continue;
			/* } else { */ case 4:
				err = new UnexpectedEventError.ptr(clientEvent);
			/* } */ case 5:
		/* } */ case 2:
		return [event, err];
		/* */ } return; } if ($f === undefined) { $f = { $blk: NewEvent }; } $f.$ptr = $ptr; $f._entry = _entry; $f._r = _r; $f._r$1 = _r$1; $f.clientEvent = clientEvent; $f.err = err; $f.event = event; $f.f = f; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.NewEvent = NewEvent;
	AccessCreated.ptr.prototype.Init = function(clientEvent) {
		var $ptr, _entry, _entry$1, _entry$2, _tuple, _tuple$1, _tuple$2, clientEvent, ok, ok$1, ok$2, source, target, x, x$1, x$2, y, y$1, y$2, y$24ptr;
		target = this;
		if (!(clientEvent.String() === "access_created")) {
			return new UnexpectedEventError.ptr(clientEvent);
		}
		source = clientEvent.Params;
		x = (_entry = source[$String.keyFor("access_key")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, $String, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.AccessKey = (y$24ptr || (y$24ptr = new ptrType(function() { return y; }, function($v) { y = $v; })));
			}
		}
		x$1 = (_entry$1 = source[$String.keyFor("access_type")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			_tuple$1 = $assertType(x$1, $String, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.AccessType = y$1;
			}
		}
		x$2 = (_entry$2 = source[$String.keyFor("event_id")], _entry$2 !== undefined ? _entry$2.v : $ifaceNil);
		if (!($interfaceIsEqual(x$2, $ifaceNil))) {
			_tuple$2 = $assertType(x$2, $Float64, true);
			y$2 = _tuple$2[0];
			ok$2 = _tuple$2[1];
			if (ok$2) {
				target.EventId = (y$2 >> 0);
			}
		}
		return $ifaceNil;
	};
	AccessCreated.prototype.Init = function(clientEvent) { return this.$val.Init(clientEvent); };
	AccessCreated.ptr.prototype.Id = function() {
		var $ptr, event;
		event = this;
		return event.EventId;
	};
	AccessCreated.prototype.Id = function() { return this.$val.Id(); };
	AccessCreated.ptr.prototype.String = function() {
		var $ptr;
		return "access_created";
	};
	AccessCreated.prototype.String = function() { return this.$val.String(); };
	AccessFound.ptr.prototype.Init = function(clientEvent) {
		var $ptr, _entry, _entry$1, _entry$10, _entry$2, _entry$3, _entry$4, _entry$5, _entry$6, _entry$7, _entry$8, _entry$9, _tuple, _tuple$1, _tuple$2, _tuple$3, _tuple$4, _tuple$5, _tuple$6, _tuple$7, _tuple$8, _tuple$9, clientEvent, ok, ok$1, ok$2, ok$3, ok$4, ok$5, ok$6, ok$7, ok$8, ok$9, source, target, x, x$1, x$10, x$2, x$3, x$4, x$5, x$6, x$7, x$8, x$9, y, y$1, y$2, y$24ptr, y$24ptr$1, y$24ptr$2, y$24ptr$3, y$24ptr$4, y$3, y$4, y$5, y$6, y$7, y$8, y$9;
		target = this;
		if (!(clientEvent.String() === "access_found")) {
			return new UnexpectedEventError.ptr(clientEvent);
		}
		source = clientEvent.Params;
		x = (_entry = source[$String.keyFor("access_type")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, $String, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.AccessType = y;
			}
		}
		x$1 = (_entry$1 = source[$String.keyFor("channel_attrs")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			_tuple$1 = $assertType(x$1, mapType, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.ChannelAttrs = NewChannelAttrs(y$1);
			}
		}
		x$2 = (_entry$2 = source[$String.keyFor("channel_id")], _entry$2 !== undefined ? _entry$2.v : $ifaceNil);
		if (!($interfaceIsEqual(x$2, $ifaceNil))) {
			_tuple$2 = $assertType(x$2, $String, true);
			y$2 = _tuple$2[0];
			ok$2 = _tuple$2[1];
			if (ok$2) {
				target.ChannelId = (y$24ptr || (y$24ptr = new ptrType(function() { return y$2; }, function($v) { y$2 = $v; })));
			}
		}
		x$3 = (_entry$3 = source[$String.keyFor("event_id")], _entry$3 !== undefined ? _entry$3.v : $ifaceNil);
		if (!($interfaceIsEqual(x$3, $ifaceNil))) {
			_tuple$3 = $assertType(x$3, $Float64, true);
			y$3 = _tuple$3[0];
			ok$3 = _tuple$3[1];
			if (ok$3) {
				target.EventId = (y$3 >> 0);
			}
		}
		x$4 = (_entry$4 = source[$String.keyFor("identity_name")], _entry$4 !== undefined ? _entry$4.v : $ifaceNil);
		if (!($interfaceIsEqual(x$4, $ifaceNil))) {
			_tuple$4 = $assertType(x$4, $String, true);
			y$4 = _tuple$4[0];
			ok$4 = _tuple$4[1];
			if (ok$4) {
				target.IdentityName = (y$24ptr$1 || (y$24ptr$1 = new ptrType(function() { return y$4; }, function($v) { y$4 = $v; })));
			}
		}
		x$5 = (_entry$5 = source[$String.keyFor("identity_type")], _entry$5 !== undefined ? _entry$5.v : $ifaceNil);
		if (!($interfaceIsEqual(x$5, $ifaceNil))) {
			_tuple$5 = $assertType(x$5, $String, true);
			y$5 = _tuple$5[0];
			ok$5 = _tuple$5[1];
			if (ok$5) {
				target.IdentityType = (y$24ptr$2 || (y$24ptr$2 = new ptrType(function() { return y$5; }, function($v) { y$5 = $v; })));
			}
		}
		x$6 = (_entry$6 = source[$String.keyFor("realm_attrs")], _entry$6 !== undefined ? _entry$6.v : $ifaceNil);
		if (!($interfaceIsEqual(x$6, $ifaceNil))) {
			_tuple$6 = $assertType(x$6, mapType, true);
			y$6 = _tuple$6[0];
			ok$6 = _tuple$6[1];
			if (ok$6) {
				target.RealmAttrs = NewRealmAttrs(y$6);
			}
		}
		x$7 = (_entry$7 = source[$String.keyFor("realm_id")], _entry$7 !== undefined ? _entry$7.v : $ifaceNil);
		if (!($interfaceIsEqual(x$7, $ifaceNil))) {
			_tuple$7 = $assertType(x$7, $String, true);
			y$7 = _tuple$7[0];
			ok$7 = _tuple$7[1];
			if (ok$7) {
				target.RealmId = (y$24ptr$3 || (y$24ptr$3 = new ptrType(function() { return y$7; }, function($v) { y$7 = $v; })));
			}
		}
		x$8 = (_entry$8 = source[$String.keyFor("realm_member")], _entry$8 !== undefined ? _entry$8.v : $ifaceNil);
		if (!($interfaceIsEqual(x$8, $ifaceNil))) {
			target.RealmMember = true;
		}
		x$9 = (_entry$9 = source[$String.keyFor("user_attrs")], _entry$9 !== undefined ? _entry$9.v : $ifaceNil);
		if (!($interfaceIsEqual(x$9, $ifaceNil))) {
			_tuple$8 = $assertType(x$9, mapType, true);
			y$8 = _tuple$8[0];
			ok$8 = _tuple$8[1];
			if (ok$8) {
				target.UserAttrs = NewUserAttrs(y$8);
			}
		}
		x$10 = (_entry$10 = source[$String.keyFor("user_id")], _entry$10 !== undefined ? _entry$10.v : $ifaceNil);
		if (!($interfaceIsEqual(x$10, $ifaceNil))) {
			_tuple$9 = $assertType(x$10, $String, true);
			y$9 = _tuple$9[0];
			ok$9 = _tuple$9[1];
			if (ok$9) {
				target.UserId = (y$24ptr$4 || (y$24ptr$4 = new ptrType(function() { return y$9; }, function($v) { y$9 = $v; })));
			}
		}
		return $ifaceNil;
	};
	AccessFound.prototype.Init = function(clientEvent) { return this.$val.Init(clientEvent); };
	AccessFound.ptr.prototype.Id = function() {
		var $ptr, event;
		event = this;
		return event.EventId;
	};
	AccessFound.prototype.Id = function() { return this.$val.Id(); };
	AccessFound.ptr.prototype.String = function() {
		var $ptr;
		return "access_found";
	};
	AccessFound.prototype.String = function() { return this.$val.String(); };
	AudienceEnqueued.ptr.prototype.Init = function(clientEvent) {
		var $ptr, _entry, _entry$1, _entry$2, _entry$3, _tuple, _tuple$1, _tuple$2, _tuple$3, clientEvent, ok, ok$1, ok$2, ok$3, source, target, x, x$1, x$2, x$3, y, y$1, y$2, y$3;
		target = this;
		if (!(clientEvent.String() === "audience_enqueued")) {
			return new UnexpectedEventError.ptr(clientEvent);
		}
		source = clientEvent.Params;
		x = (_entry = source[$String.keyFor("event_id")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, $Float64, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.EventId = (y >> 0);
			}
		}
		x$1 = (_entry$1 = source[$String.keyFor("queue_attrs")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			_tuple$1 = $assertType(x$1, mapType, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.QueueAttrs = NewQueueAttrs(y$1);
			}
		}
		x$2 = (_entry$2 = source[$String.keyFor("queue_id")], _entry$2 !== undefined ? _entry$2.v : $ifaceNil);
		if (!($interfaceIsEqual(x$2, $ifaceNil))) {
			_tuple$2 = $assertType(x$2, $String, true);
			y$2 = _tuple$2[0];
			ok$2 = _tuple$2[1];
			if (ok$2) {
				target.QueueId = y$2;
			}
		}
		x$3 = (_entry$3 = source[$String.keyFor("queue_position")], _entry$3 !== undefined ? _entry$3.v : $ifaceNil);
		if (!($interfaceIsEqual(x$3, $ifaceNil))) {
			_tuple$3 = $assertType(x$3, $Float64, true);
			y$3 = _tuple$3[0];
			ok$3 = _tuple$3[1];
			if (ok$3) {
				target.QueuePosition = (y$3 >> 0);
			}
		}
		return $ifaceNil;
	};
	AudienceEnqueued.prototype.Init = function(clientEvent) { return this.$val.Init(clientEvent); };
	AudienceEnqueued.ptr.prototype.Id = function() {
		var $ptr, event;
		event = this;
		return event.EventId;
	};
	AudienceEnqueued.prototype.Id = function() { return this.$val.Id(); };
	AudienceEnqueued.ptr.prototype.String = function() {
		var $ptr;
		return "audience_enqueued";
	};
	AudienceEnqueued.prototype.String = function() { return this.$val.String(); };
	ChannelDeleted.ptr.prototype.Init = function(clientEvent) {
		var $ptr, _entry, _entry$1, _tuple, _tuple$1, clientEvent, ok, ok$1, source, target, x, x$1, y, y$1;
		target = this;
		if (!(clientEvent.String() === "channel_deleted")) {
			return new UnexpectedEventError.ptr(clientEvent);
		}
		source = clientEvent.Params;
		x = (_entry = source[$String.keyFor("channel_id")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, $String, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.ChannelId = y;
			}
		}
		x$1 = (_entry$1 = source[$String.keyFor("event_id")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			_tuple$1 = $assertType(x$1, $Float64, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.EventId = (y$1 >> 0);
			}
		}
		return $ifaceNil;
	};
	ChannelDeleted.prototype.Init = function(clientEvent) { return this.$val.Init(clientEvent); };
	ChannelDeleted.ptr.prototype.Id = function() {
		var $ptr, event;
		event = this;
		return event.EventId;
	};
	ChannelDeleted.prototype.Id = function() { return this.$val.Id(); };
	ChannelDeleted.ptr.prototype.String = function() {
		var $ptr;
		return "channel_deleted";
	};
	ChannelDeleted.prototype.String = function() { return this.$val.String(); };
	ChannelFound.ptr.prototype.Init = function(clientEvent) {
		var $ptr, _entry, _entry$1, _entry$2, _entry$3, _entry$4, _entry$5, _tuple, _tuple$1, _tuple$2, _tuple$3, _tuple$4, _tuple$5, clientEvent, ok, ok$1, ok$2, ok$3, ok$4, ok$5, source, target, x, x$1, x$2, x$3, x$4, x$5, y, y$1, y$2, y$24ptr, y$24ptr$1, y$3, y$4, y$5;
		target = this;
		if (!(clientEvent.String() === "channel_found")) {
			return new UnexpectedEventError.ptr(clientEvent);
		}
		source = clientEvent.Params;
		x = (_entry = source[$String.keyFor("channel_attrs")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, mapType, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.ChannelAttrs = NewChannelAttrs(y);
			}
		}
		x$1 = (_entry$1 = source[$String.keyFor("channel_id")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			_tuple$1 = $assertType(x$1, $String, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.ChannelId = y$1;
			}
		}
		x$2 = (_entry$2 = source[$String.keyFor("channel_members")], _entry$2 !== undefined ? _entry$2.v : $ifaceNil);
		if (!($interfaceIsEqual(x$2, $ifaceNil))) {
			_tuple$2 = $assertType(x$2, mapType, true);
			y$2 = _tuple$2[0];
			ok$2 = _tuple$2[1];
			if (ok$2) {
				target.ChannelMembers = MakeChannelMembers(y$2);
			}
		}
		x$3 = (_entry$3 = source[$String.keyFor("channel_status")], _entry$3 !== undefined ? _entry$3.v : $ifaceNil);
		if (!($interfaceIsEqual(x$3, $ifaceNil))) {
			_tuple$3 = $assertType(x$3, $String, true);
			y$3 = _tuple$3[0];
			ok$3 = _tuple$3[1];
			if (ok$3) {
				target.ChannelStatus = (y$24ptr || (y$24ptr = new ptrType(function() { return y$3; }, function($v) { y$3 = $v; })));
			}
		}
		x$4 = (_entry$4 = source[$String.keyFor("event_id")], _entry$4 !== undefined ? _entry$4.v : $ifaceNil);
		if (!($interfaceIsEqual(x$4, $ifaceNil))) {
			_tuple$4 = $assertType(x$4, $Float64, true);
			y$4 = _tuple$4[0];
			ok$4 = _tuple$4[1];
			if (ok$4) {
				target.EventId = (y$4 >> 0);
			}
		}
		x$5 = (_entry$5 = source[$String.keyFor("realm_id")], _entry$5 !== undefined ? _entry$5.v : $ifaceNil);
		if (!($interfaceIsEqual(x$5, $ifaceNil))) {
			_tuple$5 = $assertType(x$5, $String, true);
			y$5 = _tuple$5[0];
			ok$5 = _tuple$5[1];
			if (ok$5) {
				target.RealmId = (y$24ptr$1 || (y$24ptr$1 = new ptrType(function() { return y$5; }, function($v) { y$5 = $v; })));
			}
		}
		return $ifaceNil;
	};
	ChannelFound.prototype.Init = function(clientEvent) { return this.$val.Init(clientEvent); };
	ChannelFound.ptr.prototype.Id = function() {
		var $ptr, event;
		event = this;
		return event.EventId;
	};
	ChannelFound.prototype.Id = function() { return this.$val.Id(); };
	ChannelFound.ptr.prototype.String = function() {
		var $ptr;
		return "channel_found";
	};
	ChannelFound.prototype.String = function() { return this.$val.String(); };
	ChannelJoined.ptr.prototype.Init = function(clientEvent) {
		var $ptr, _entry, _entry$1, _entry$2, _entry$3, _entry$4, _tuple, _tuple$1, _tuple$2, _tuple$3, _tuple$4, clientEvent, ok, ok$1, ok$2, ok$3, ok$4, source, target, x, x$1, x$2, x$3, x$4, y, y$1, y$2, y$24ptr, y$3, y$4;
		target = this;
		if (!(clientEvent.String() === "channel_joined")) {
			return new UnexpectedEventError.ptr(clientEvent);
		}
		source = clientEvent.Params;
		x = (_entry = source[$String.keyFor("channel_attrs")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, mapType, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.ChannelAttrs = NewChannelAttrs(y);
			}
		}
		x$1 = (_entry$1 = source[$String.keyFor("channel_id")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			_tuple$1 = $assertType(x$1, $String, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.ChannelId = y$1;
			}
		}
		x$2 = (_entry$2 = source[$String.keyFor("channel_members")], _entry$2 !== undefined ? _entry$2.v : $ifaceNil);
		if (!($interfaceIsEqual(x$2, $ifaceNil))) {
			_tuple$2 = $assertType(x$2, mapType, true);
			y$2 = _tuple$2[0];
			ok$2 = _tuple$2[1];
			if (ok$2) {
				target.ChannelMembers = MakeChannelMembers(y$2);
			}
		}
		x$3 = (_entry$3 = source[$String.keyFor("event_id")], _entry$3 !== undefined ? _entry$3.v : $ifaceNil);
		if (!($interfaceIsEqual(x$3, $ifaceNil))) {
			_tuple$3 = $assertType(x$3, $Float64, true);
			y$3 = _tuple$3[0];
			ok$3 = _tuple$3[1];
			if (ok$3) {
				target.EventId = (y$3 >> 0);
			}
		}
		x$4 = (_entry$4 = source[$String.keyFor("realm_id")], _entry$4 !== undefined ? _entry$4.v : $ifaceNil);
		if (!($interfaceIsEqual(x$4, $ifaceNil))) {
			_tuple$4 = $assertType(x$4, $String, true);
			y$4 = _tuple$4[0];
			ok$4 = _tuple$4[1];
			if (ok$4) {
				target.RealmId = (y$24ptr || (y$24ptr = new ptrType(function() { return y$4; }, function($v) { y$4 = $v; })));
			}
		}
		return $ifaceNil;
	};
	ChannelJoined.prototype.Init = function(clientEvent) { return this.$val.Init(clientEvent); };
	ChannelJoined.ptr.prototype.Id = function() {
		var $ptr, event;
		event = this;
		return event.EventId;
	};
	ChannelJoined.prototype.Id = function() { return this.$val.Id(); };
	ChannelJoined.ptr.prototype.String = function() {
		var $ptr;
		return "channel_joined";
	};
	ChannelJoined.prototype.String = function() { return this.$val.String(); };
	ChannelMemberJoined.ptr.prototype.Init = function(clientEvent) {
		var $ptr, _entry, _entry$1, _entry$2, _entry$3, _entry$4, _entry$5, _tuple, _tuple$1, _tuple$2, _tuple$3, _tuple$4, _tuple$5, clientEvent, ok, ok$1, ok$2, ok$3, ok$4, ok$5, source, target, x, x$1, x$2, x$3, x$4, x$5, y, y$1, y$2, y$3, y$4, y$5;
		target = this;
		if (!(clientEvent.String() === "channel_member_joined")) {
			return new UnexpectedEventError.ptr(clientEvent);
		}
		source = clientEvent.Params;
		x = (_entry = source[$String.keyFor("channel_id")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, $String, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.ChannelId = y;
			}
		}
		x$1 = (_entry$1 = source[$String.keyFor("event_id")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			_tuple$1 = $assertType(x$1, $Float64, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.EventId = (y$1 >> 0);
			}
		}
		x$2 = (_entry$2 = source[$String.keyFor("member_attrs")], _entry$2 !== undefined ? _entry$2.v : $ifaceNil);
		if (!($interfaceIsEqual(x$2, $ifaceNil))) {
			_tuple$2 = $assertType(x$2, mapType, true);
			y$2 = _tuple$2[0];
			ok$2 = _tuple$2[1];
			if (ok$2) {
				target.MemberAttrs = NewChannelMemberAttrs(y$2);
			}
		}
		x$3 = (_entry$3 = source[$String.keyFor("puppet_attrs")], _entry$3 !== undefined ? _entry$3.v : $ifaceNil);
		if (!($interfaceIsEqual(x$3, $ifaceNil))) {
			_tuple$3 = $assertType(x$3, mapType, true);
			y$3 = _tuple$3[0];
			ok$3 = _tuple$3[1];
			if (ok$3) {
				target.PuppetAttrs = NewPuppetAttrs(y$3);
			}
		}
		x$4 = (_entry$4 = source[$String.keyFor("user_attrs")], _entry$4 !== undefined ? _entry$4.v : $ifaceNil);
		if (!($interfaceIsEqual(x$4, $ifaceNil))) {
			_tuple$4 = $assertType(x$4, mapType, true);
			y$4 = _tuple$4[0];
			ok$4 = _tuple$4[1];
			if (ok$4) {
				target.UserAttrs = NewUserAttrs(y$4);
			}
		}
		x$5 = (_entry$5 = source[$String.keyFor("user_id")], _entry$5 !== undefined ? _entry$5.v : $ifaceNil);
		if (!($interfaceIsEqual(x$5, $ifaceNil))) {
			_tuple$5 = $assertType(x$5, $String, true);
			y$5 = _tuple$5[0];
			ok$5 = _tuple$5[1];
			if (ok$5) {
				target.UserId = y$5;
			}
		}
		return $ifaceNil;
	};
	ChannelMemberJoined.prototype.Init = function(clientEvent) { return this.$val.Init(clientEvent); };
	ChannelMemberJoined.ptr.prototype.Id = function() {
		var $ptr, event;
		event = this;
		return event.EventId;
	};
	ChannelMemberJoined.prototype.Id = function() { return this.$val.Id(); };
	ChannelMemberJoined.ptr.prototype.String = function() {
		var $ptr;
		return "channel_member_joined";
	};
	ChannelMemberJoined.prototype.String = function() { return this.$val.String(); };
	ChannelMemberParted.ptr.prototype.Init = function(clientEvent) {
		var $ptr, _entry, _entry$1, _entry$2, _entry$3, _tuple, _tuple$1, _tuple$2, _tuple$3, clientEvent, ok, ok$1, ok$2, ok$3, source, target, x, x$1, x$2, x$3, y, y$1, y$2, y$24ptr, y$24ptr$1, y$3;
		target = this;
		if (!(clientEvent.String() === "channel_member_parted")) {
			return new UnexpectedEventError.ptr(clientEvent);
		}
		source = clientEvent.Params;
		x = (_entry = source[$String.keyFor("channel_id")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, $String, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.ChannelId = (y$24ptr || (y$24ptr = new ptrType(function() { return y; }, function($v) { y = $v; })));
			}
		}
		x$1 = (_entry$1 = source[$String.keyFor("event_id")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			_tuple$1 = $assertType(x$1, $Float64, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.EventId = (y$1 >> 0);
			}
		}
		x$2 = (_entry$2 = source[$String.keyFor("realm_id")], _entry$2 !== undefined ? _entry$2.v : $ifaceNil);
		if (!($interfaceIsEqual(x$2, $ifaceNil))) {
			_tuple$2 = $assertType(x$2, $String, true);
			y$2 = _tuple$2[0];
			ok$2 = _tuple$2[1];
			if (ok$2) {
				target.RealmId = (y$24ptr$1 || (y$24ptr$1 = new ptrType(function() { return y$2; }, function($v) { y$2 = $v; })));
			}
		}
		x$3 = (_entry$3 = source[$String.keyFor("user_id")], _entry$3 !== undefined ? _entry$3.v : $ifaceNil);
		if (!($interfaceIsEqual(x$3, $ifaceNil))) {
			_tuple$3 = $assertType(x$3, $String, true);
			y$3 = _tuple$3[0];
			ok$3 = _tuple$3[1];
			if (ok$3) {
				target.UserId = y$3;
			}
		}
		return $ifaceNil;
	};
	ChannelMemberParted.prototype.Init = function(clientEvent) { return this.$val.Init(clientEvent); };
	ChannelMemberParted.ptr.prototype.Id = function() {
		var $ptr, event;
		event = this;
		return event.EventId;
	};
	ChannelMemberParted.prototype.Id = function() { return this.$val.Id(); };
	ChannelMemberParted.ptr.prototype.String = function() {
		var $ptr;
		return "channel_member_parted";
	};
	ChannelMemberParted.prototype.String = function() { return this.$val.String(); };
	ChannelMemberUpdated.ptr.prototype.Init = function(clientEvent) {
		var $ptr, _entry, _entry$1, _entry$2, _entry$3, _entry$4, _tuple, _tuple$1, _tuple$2, _tuple$3, _tuple$4, clientEvent, ok, ok$1, ok$2, ok$3, ok$4, source, target, x, x$1, x$2, x$3, x$4, y, y$1, y$2, y$24ptr, y$24ptr$1, y$3, y$4;
		target = this;
		if (!(clientEvent.String() === "channel_member_updated")) {
			return new UnexpectedEventError.ptr(clientEvent);
		}
		source = clientEvent.Params;
		x = (_entry = source[$String.keyFor("channel_id")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, $String, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.ChannelId = (y$24ptr || (y$24ptr = new ptrType(function() { return y; }, function($v) { y = $v; })));
			}
		}
		x$1 = (_entry$1 = source[$String.keyFor("event_id")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			_tuple$1 = $assertType(x$1, $Float64, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.EventId = (y$1 >> 0);
			}
		}
		x$2 = (_entry$2 = source[$String.keyFor("member_attrs")], _entry$2 !== undefined ? _entry$2.v : $ifaceNil);
		if (!($interfaceIsEqual(x$2, $ifaceNil))) {
			_tuple$2 = $assertType(x$2, mapType, true);
			y$2 = _tuple$2[0];
			ok$2 = _tuple$2[1];
			if (ok$2) {
				target.MemberAttrs = NewChannelMemberAttrs(y$2);
			}
		}
		x$3 = (_entry$3 = source[$String.keyFor("realm_id")], _entry$3 !== undefined ? _entry$3.v : $ifaceNil);
		if (!($interfaceIsEqual(x$3, $ifaceNil))) {
			_tuple$3 = $assertType(x$3, $String, true);
			y$3 = _tuple$3[0];
			ok$3 = _tuple$3[1];
			if (ok$3) {
				target.RealmId = (y$24ptr$1 || (y$24ptr$1 = new ptrType(function() { return y$3; }, function($v) { y$3 = $v; })));
			}
		}
		x$4 = (_entry$4 = source[$String.keyFor("user_id")], _entry$4 !== undefined ? _entry$4.v : $ifaceNil);
		if (!($interfaceIsEqual(x$4, $ifaceNil))) {
			_tuple$4 = $assertType(x$4, $String, true);
			y$4 = _tuple$4[0];
			ok$4 = _tuple$4[1];
			if (ok$4) {
				target.UserId = y$4;
			}
		}
		return $ifaceNil;
	};
	ChannelMemberUpdated.prototype.Init = function(clientEvent) { return this.$val.Init(clientEvent); };
	ChannelMemberUpdated.ptr.prototype.Id = function() {
		var $ptr, event;
		event = this;
		return event.EventId;
	};
	ChannelMemberUpdated.prototype.Id = function() { return this.$val.Id(); };
	ChannelMemberUpdated.ptr.prototype.String = function() {
		var $ptr;
		return "channel_member_updated";
	};
	ChannelMemberUpdated.prototype.String = function() { return this.$val.String(); };
	ChannelParted.ptr.prototype.Init = function(clientEvent) {
		var $ptr, _entry, _entry$1, _tuple, _tuple$1, clientEvent, ok, ok$1, source, target, x, x$1, y, y$1;
		target = this;
		if (!(clientEvent.String() === "channel_parted")) {
			return new UnexpectedEventError.ptr(clientEvent);
		}
		source = clientEvent.Params;
		x = (_entry = source[$String.keyFor("channel_id")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, $String, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.ChannelId = y;
			}
		}
		x$1 = (_entry$1 = source[$String.keyFor("event_id")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			_tuple$1 = $assertType(x$1, $Float64, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.EventId = (y$1 >> 0);
			}
		}
		return $ifaceNil;
	};
	ChannelParted.prototype.Init = function(clientEvent) { return this.$val.Init(clientEvent); };
	ChannelParted.ptr.prototype.Id = function() {
		var $ptr, event;
		event = this;
		return event.EventId;
	};
	ChannelParted.prototype.Id = function() { return this.$val.Id(); };
	ChannelParted.ptr.prototype.String = function() {
		var $ptr;
		return "channel_parted";
	};
	ChannelParted.prototype.String = function() { return this.$val.String(); };
	ChannelUpdated.ptr.prototype.Init = function(clientEvent) {
		var $ptr, _entry, _entry$1, _entry$2, _entry$3, _tuple, _tuple$1, _tuple$2, _tuple$3, clientEvent, ok, ok$1, ok$2, ok$3, source, target, x, x$1, x$2, x$3, y, y$1, y$2, y$24ptr, y$3;
		target = this;
		if (!(clientEvent.String() === "channel_updated")) {
			return new UnexpectedEventError.ptr(clientEvent);
		}
		source = clientEvent.Params;
		x = (_entry = source[$String.keyFor("channel_attrs")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, mapType, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.ChannelAttrs = NewChannelAttrs(y);
			}
		}
		x$1 = (_entry$1 = source[$String.keyFor("channel_id")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			_tuple$1 = $assertType(x$1, $String, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.ChannelId = y$1;
			}
		}
		x$2 = (_entry$2 = source[$String.keyFor("event_id")], _entry$2 !== undefined ? _entry$2.v : $ifaceNil);
		if (!($interfaceIsEqual(x$2, $ifaceNil))) {
			_tuple$2 = $assertType(x$2, $Float64, true);
			y$2 = _tuple$2[0];
			ok$2 = _tuple$2[1];
			if (ok$2) {
				target.EventId = (y$2 >> 0);
			}
		}
		x$3 = (_entry$3 = source[$String.keyFor("realm_id")], _entry$3 !== undefined ? _entry$3.v : $ifaceNil);
		if (!($interfaceIsEqual(x$3, $ifaceNil))) {
			_tuple$3 = $assertType(x$3, $String, true);
			y$3 = _tuple$3[0];
			ok$3 = _tuple$3[1];
			if (ok$3) {
				target.RealmId = (y$24ptr || (y$24ptr = new ptrType(function() { return y$3; }, function($v) { y$3 = $v; })));
			}
		}
		return $ifaceNil;
	};
	ChannelUpdated.prototype.Init = function(clientEvent) { return this.$val.Init(clientEvent); };
	ChannelUpdated.ptr.prototype.Id = function() {
		var $ptr, event;
		event = this;
		return event.EventId;
	};
	ChannelUpdated.prototype.Id = function() { return this.$val.Id(); };
	ChannelUpdated.ptr.prototype.String = function() {
		var $ptr;
		return "channel_updated";
	};
	ChannelUpdated.prototype.String = function() { return this.$val.String(); };
	DialogueUpdated.ptr.prototype.Init = function(clientEvent) {
		var $ptr, _entry, _entry$1, _entry$2, _entry$3, _entry$4, _tuple, _tuple$1, _tuple$2, _tuple$3, _tuple$4, clientEvent, ok, ok$1, ok$2, ok$3, ok$4, source, target, x, x$1, x$2, x$3, x$4, y, y$1, y$2, y$24ptr, y$3, y$4;
		target = this;
		if (!(clientEvent.String() === "dialogue_updated")) {
			return new UnexpectedEventError.ptr(clientEvent);
		}
		source = clientEvent.Params;
		x = (_entry = source[$String.keyFor("audience_metadata")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, mapType, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.AudienceMetadata = y;
			}
		}
		x$1 = (_entry$1 = source[$String.keyFor("dialogue_members")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			_tuple$1 = $assertType(x$1, mapType, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.DialogueMembers = MakeDialogueMembers(y$1);
			}
		}
		x$2 = (_entry$2 = source[$String.keyFor("dialogue_status")], _entry$2 !== undefined ? _entry$2.v : $ifaceNil);
		if (!($interfaceIsEqual(x$2, $ifaceNil))) {
			_tuple$2 = $assertType(x$2, $String, true);
			y$2 = _tuple$2[0];
			ok$2 = _tuple$2[1];
			if (ok$2) {
				target.DialogueStatus = (y$24ptr || (y$24ptr = new ptrType(function() { return y$2; }, function($v) { y$2 = $v; })));
			}
		}
		x$3 = (_entry$3 = source[$String.keyFor("event_id")], _entry$3 !== undefined ? _entry$3.v : $ifaceNil);
		if (!($interfaceIsEqual(x$3, $ifaceNil))) {
			_tuple$3 = $assertType(x$3, $Float64, true);
			y$3 = _tuple$3[0];
			ok$3 = _tuple$3[1];
			if (ok$3) {
				target.EventId = (y$3 >> 0);
			}
		}
		x$4 = (_entry$4 = source[$String.keyFor("user_id")], _entry$4 !== undefined ? _entry$4.v : $ifaceNil);
		if (!($interfaceIsEqual(x$4, $ifaceNil))) {
			_tuple$4 = $assertType(x$4, $String, true);
			y$4 = _tuple$4[0];
			ok$4 = _tuple$4[1];
			if (ok$4) {
				target.UserId = y$4;
			}
		}
		return $ifaceNil;
	};
	DialogueUpdated.prototype.Init = function(clientEvent) { return this.$val.Init(clientEvent); };
	DialogueUpdated.ptr.prototype.Id = function() {
		var $ptr, event;
		event = this;
		return event.EventId;
	};
	DialogueUpdated.prototype.Id = function() { return this.$val.Id(); };
	DialogueUpdated.ptr.prototype.String = function() {
		var $ptr;
		return "dialogue_updated";
	};
	DialogueUpdated.prototype.String = function() { return this.$val.String(); };
	NewError = function(clientEvent) {
		var $ptr, clientEvent, e, err, event;
		event = ptrType$72.nil;
		if (!(clientEvent === ptrType$15.nil)) {
			e = new Error.ptr(ptrType.nil, ptrType.nil, "", 0, ptrType.nil, ptrType.nil, ptrType.nil, ptrType.nil, ptrType.nil, ptrType.nil);
			err = e.Init(clientEvent);
			if (!($interfaceIsEqual(err, $ifaceNil))) {
				$panic(err);
			}
			event = e;
		}
		return event;
	};
	$pkg.NewError = NewError;
	Error.ptr.prototype.Init = function(clientEvent) {
		var $ptr, _entry, _entry$1, _entry$2, _entry$3, _entry$4, _entry$5, _entry$6, _entry$7, _entry$8, _entry$9, _tuple, _tuple$1, _tuple$2, _tuple$3, _tuple$4, _tuple$5, _tuple$6, _tuple$7, _tuple$8, _tuple$9, clientEvent, ok, ok$1, ok$2, ok$3, ok$4, ok$5, ok$6, ok$7, ok$8, ok$9, source, target, x, x$1, x$2, x$3, x$4, x$5, x$6, x$7, x$8, x$9, y, y$1, y$2, y$24ptr, y$24ptr$1, y$24ptr$2, y$24ptr$3, y$24ptr$4, y$24ptr$5, y$24ptr$6, y$24ptr$7, y$3, y$4, y$5, y$6, y$7, y$8, y$9;
		target = this;
		if (!(clientEvent.String() === "error")) {
			return new UnexpectedEventError.ptr(clientEvent);
		}
		source = clientEvent.Params;
		x = (_entry = source[$String.keyFor("channel_id")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, $String, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.ChannelId = (y$24ptr || (y$24ptr = new ptrType(function() { return y; }, function($v) { y = $v; })));
			}
		}
		x$1 = (_entry$1 = source[$String.keyFor("error_reason")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			_tuple$1 = $assertType(x$1, $String, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.ErrorReason = (y$24ptr$1 || (y$24ptr$1 = new ptrType(function() { return y$1; }, function($v) { y$1 = $v; })));
			}
		}
		x$2 = (_entry$2 = source[$String.keyFor("error_type")], _entry$2 !== undefined ? _entry$2.v : $ifaceNil);
		if (!($interfaceIsEqual(x$2, $ifaceNil))) {
			_tuple$2 = $assertType(x$2, $String, true);
			y$2 = _tuple$2[0];
			ok$2 = _tuple$2[1];
			if (ok$2) {
				target.ErrorType = y$2;
			}
		}
		x$3 = (_entry$3 = source[$String.keyFor("event_id")], _entry$3 !== undefined ? _entry$3.v : $ifaceNil);
		if (!($interfaceIsEqual(x$3, $ifaceNil))) {
			_tuple$3 = $assertType(x$3, $Float64, true);
			y$3 = _tuple$3[0];
			ok$3 = _tuple$3[1];
			if (ok$3) {
				target.EventId = (y$3 >> 0);
			}
		}
		x$4 = (_entry$4 = source[$String.keyFor("identity_name")], _entry$4 !== undefined ? _entry$4.v : $ifaceNil);
		if (!($interfaceIsEqual(x$4, $ifaceNil))) {
			_tuple$4 = $assertType(x$4, $String, true);
			y$4 = _tuple$4[0];
			ok$4 = _tuple$4[1];
			if (ok$4) {
				target.IdentityName = (y$24ptr$2 || (y$24ptr$2 = new ptrType(function() { return y$4; }, function($v) { y$4 = $v; })));
			}
		}
		x$5 = (_entry$5 = source[$String.keyFor("identity_type")], _entry$5 !== undefined ? _entry$5.v : $ifaceNil);
		if (!($interfaceIsEqual(x$5, $ifaceNil))) {
			_tuple$5 = $assertType(x$5, $String, true);
			y$5 = _tuple$5[0];
			ok$5 = _tuple$5[1];
			if (ok$5) {
				target.IdentityType = (y$24ptr$3 || (y$24ptr$3 = new ptrType(function() { return y$5; }, function($v) { y$5 = $v; })));
			}
		}
		x$6 = (_entry$6 = source[$String.keyFor("message_type")], _entry$6 !== undefined ? _entry$6.v : $ifaceNil);
		if (!($interfaceIsEqual(x$6, $ifaceNil))) {
			_tuple$6 = $assertType(x$6, $String, true);
			y$6 = _tuple$6[0];
			ok$6 = _tuple$6[1];
			if (ok$6) {
				target.MessageType = (y$24ptr$4 || (y$24ptr$4 = new ptrType(function() { return y$6; }, function($v) { y$6 = $v; })));
			}
		}
		x$7 = (_entry$7 = source[$String.keyFor("queue_id")], _entry$7 !== undefined ? _entry$7.v : $ifaceNil);
		if (!($interfaceIsEqual(x$7, $ifaceNil))) {
			_tuple$7 = $assertType(x$7, $String, true);
			y$7 = _tuple$7[0];
			ok$7 = _tuple$7[1];
			if (ok$7) {
				target.QueueId = (y$24ptr$5 || (y$24ptr$5 = new ptrType(function() { return y$7; }, function($v) { y$7 = $v; })));
			}
		}
		x$8 = (_entry$8 = source[$String.keyFor("realm_id")], _entry$8 !== undefined ? _entry$8.v : $ifaceNil);
		if (!($interfaceIsEqual(x$8, $ifaceNil))) {
			_tuple$8 = $assertType(x$8, $String, true);
			y$8 = _tuple$8[0];
			ok$8 = _tuple$8[1];
			if (ok$8) {
				target.RealmId = (y$24ptr$6 || (y$24ptr$6 = new ptrType(function() { return y$8; }, function($v) { y$8 = $v; })));
			}
		}
		x$9 = (_entry$9 = source[$String.keyFor("user_id")], _entry$9 !== undefined ? _entry$9.v : $ifaceNil);
		if (!($interfaceIsEqual(x$9, $ifaceNil))) {
			_tuple$9 = $assertType(x$9, $String, true);
			y$9 = _tuple$9[0];
			ok$9 = _tuple$9[1];
			if (ok$9) {
				target.UserId = (y$24ptr$7 || (y$24ptr$7 = new ptrType(function() { return y$9; }, function($v) { y$9 = $v; })));
			}
		}
		return $ifaceNil;
	};
	Error.prototype.Init = function(clientEvent) { return this.$val.Init(clientEvent); };
	Error.ptr.prototype.Id = function() {
		var $ptr, event;
		event = this;
		return event.EventId;
	};
	Error.prototype.Id = function() { return this.$val.Id(); };
	Error.ptr.prototype.String = function() {
		var $ptr;
		return "error";
	};
	Error.prototype.String = function() { return this.$val.String(); };
	HistoryDiscarded.ptr.prototype.Init = function(clientEvent) {
		var $ptr, _entry, _entry$1, _entry$2, _entry$3, _tuple, _tuple$1, _tuple$2, _tuple$3, clientEvent, ok, ok$1, ok$2, ok$3, source, target, x, x$1, x$2, x$3, y, y$1, y$2, y$24ptr, y$24ptr$1, y$3;
		target = this;
		if (!(clientEvent.String() === "history_discarded")) {
			return new UnexpectedEventError.ptr(clientEvent);
		}
		source = clientEvent.Params;
		x = (_entry = source[$String.keyFor("channel_id")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, $String, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.ChannelId = (y$24ptr || (y$24ptr = new ptrType(function() { return y; }, function($v) { y = $v; })));
			}
		}
		x$1 = (_entry$1 = source[$String.keyFor("event_id")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			_tuple$1 = $assertType(x$1, $Float64, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.EventId = (y$1 >> 0);
			}
		}
		x$2 = (_entry$2 = source[$String.keyFor("message_id")], _entry$2 !== undefined ? _entry$2.v : $ifaceNil);
		if (!($interfaceIsEqual(x$2, $ifaceNil))) {
			_tuple$2 = $assertType(x$2, $String, true);
			y$2 = _tuple$2[0];
			ok$2 = _tuple$2[1];
			if (ok$2) {
				target.MessageId = y$2;
			}
		}
		x$3 = (_entry$3 = source[$String.keyFor("user_id")], _entry$3 !== undefined ? _entry$3.v : $ifaceNil);
		if (!($interfaceIsEqual(x$3, $ifaceNil))) {
			_tuple$3 = $assertType(x$3, $String, true);
			y$3 = _tuple$3[0];
			ok$3 = _tuple$3[1];
			if (ok$3) {
				target.UserId = (y$24ptr$1 || (y$24ptr$1 = new ptrType(function() { return y$3; }, function($v) { y$3 = $v; })));
			}
		}
		return $ifaceNil;
	};
	HistoryDiscarded.prototype.Init = function(clientEvent) { return this.$val.Init(clientEvent); };
	HistoryDiscarded.ptr.prototype.Id = function() {
		var $ptr, event;
		event = this;
		return event.EventId;
	};
	HistoryDiscarded.prototype.Id = function() { return this.$val.Id(); };
	HistoryDiscarded.ptr.prototype.String = function() {
		var $ptr;
		return "history_discarded";
	};
	HistoryDiscarded.prototype.String = function() { return this.$val.String(); };
	HistoryResults.ptr.prototype.Init = function(clientEvent) {
		var $ptr, _entry, _entry$1, _entry$2, _entry$3, _entry$4, _tuple, _tuple$1, _tuple$2, _tuple$3, _tuple$4, clientEvent, ok, ok$1, ok$2, ok$3, ok$4, source, target, x, x$1, x$2, x$3, x$4, y, y$1, y$2, y$24ptr, y$24ptr$1, y$24ptr$2, y$3, y$4;
		target = this;
		if (!(clientEvent.String() === "history_results")) {
			return new UnexpectedEventError.ptr(clientEvent);
		}
		source = clientEvent.Params;
		x = (_entry = source[$String.keyFor("channel_id")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, $String, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.ChannelId = (y$24ptr || (y$24ptr = new ptrType(function() { return y; }, function($v) { y = $v; })));
			}
		}
		x$1 = (_entry$1 = source[$String.keyFor("event_id")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			_tuple$1 = $assertType(x$1, $Float64, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.EventId = (y$1 >> 0);
			}
		}
		x$2 = (_entry$2 = source[$String.keyFor("history_length")], _entry$2 !== undefined ? _entry$2.v : $ifaceNil);
		if (!($interfaceIsEqual(x$2, $ifaceNil))) {
			_tuple$2 = $assertType(x$2, $Float64, true);
			y$2 = _tuple$2[0];
			ok$2 = _tuple$2[1];
			if (ok$2) {
				target.HistoryLength = (y$2 >> 0);
			}
		}
		x$3 = (_entry$3 = source[$String.keyFor("message_id")], _entry$3 !== undefined ? _entry$3.v : $ifaceNil);
		if (!($interfaceIsEqual(x$3, $ifaceNil))) {
			_tuple$3 = $assertType(x$3, $String, true);
			y$3 = _tuple$3[0];
			ok$3 = _tuple$3[1];
			if (ok$3) {
				target.MessageId = (y$24ptr$1 || (y$24ptr$1 = new ptrType(function() { return y$3; }, function($v) { y$3 = $v; })));
			}
		}
		x$4 = (_entry$4 = source[$String.keyFor("user_id")], _entry$4 !== undefined ? _entry$4.v : $ifaceNil);
		if (!($interfaceIsEqual(x$4, $ifaceNil))) {
			_tuple$4 = $assertType(x$4, $String, true);
			y$4 = _tuple$4[0];
			ok$4 = _tuple$4[1];
			if (ok$4) {
				target.UserId = (y$24ptr$2 || (y$24ptr$2 = new ptrType(function() { return y$4; }, function($v) { y$4 = $v; })));
			}
		}
		return $ifaceNil;
	};
	HistoryResults.prototype.Init = function(clientEvent) { return this.$val.Init(clientEvent); };
	HistoryResults.ptr.prototype.Id = function() {
		var $ptr, event;
		event = this;
		return event.EventId;
	};
	HistoryResults.prototype.Id = function() { return this.$val.Id(); };
	HistoryResults.ptr.prototype.String = function() {
		var $ptr;
		return "history_results";
	};
	HistoryResults.prototype.String = function() { return this.$val.String(); };
	IdentityCreated.ptr.prototype.Init = function(clientEvent) {
		var $ptr, _entry, _entry$1, _entry$2, _entry$3, _tuple, _tuple$1, _tuple$2, _tuple$3, clientEvent, ok, ok$1, ok$2, ok$3, source, target, x, x$1, x$2, x$3, y, y$1, y$2, y$3;
		target = this;
		if (!(clientEvent.String() === "identity_created")) {
			return new UnexpectedEventError.ptr(clientEvent);
		}
		source = clientEvent.Params;
		x = (_entry = source[$String.keyFor("event_id")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, $Float64, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.EventId = (y >> 0);
			}
		}
		x$1 = (_entry$1 = source[$String.keyFor("identity_attrs")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			_tuple$1 = $assertType(x$1, mapType, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.IdentityAttrs = NewIdentityAttrs(y$1);
			}
		}
		x$2 = (_entry$2 = source[$String.keyFor("identity_name")], _entry$2 !== undefined ? _entry$2.v : $ifaceNil);
		if (!($interfaceIsEqual(x$2, $ifaceNil))) {
			_tuple$2 = $assertType(x$2, $String, true);
			y$2 = _tuple$2[0];
			ok$2 = _tuple$2[1];
			if (ok$2) {
				target.IdentityName = y$2;
			}
		}
		x$3 = (_entry$3 = source[$String.keyFor("identity_type")], _entry$3 !== undefined ? _entry$3.v : $ifaceNil);
		if (!($interfaceIsEqual(x$3, $ifaceNil))) {
			_tuple$3 = $assertType(x$3, $String, true);
			y$3 = _tuple$3[0];
			ok$3 = _tuple$3[1];
			if (ok$3) {
				target.IdentityType = y$3;
			}
		}
		return $ifaceNil;
	};
	IdentityCreated.prototype.Init = function(clientEvent) { return this.$val.Init(clientEvent); };
	IdentityCreated.ptr.prototype.Id = function() {
		var $ptr, event;
		event = this;
		return event.EventId;
	};
	IdentityCreated.prototype.Id = function() { return this.$val.Id(); };
	IdentityCreated.ptr.prototype.String = function() {
		var $ptr;
		return "identity_created";
	};
	IdentityCreated.prototype.String = function() { return this.$val.String(); };
	IdentityDeleted.ptr.prototype.Init = function(clientEvent) {
		var $ptr, _entry, _entry$1, _entry$2, _tuple, _tuple$1, _tuple$2, clientEvent, ok, ok$1, ok$2, source, target, x, x$1, x$2, y, y$1, y$2;
		target = this;
		if (!(clientEvent.String() === "identity_deleted")) {
			return new UnexpectedEventError.ptr(clientEvent);
		}
		source = clientEvent.Params;
		x = (_entry = source[$String.keyFor("event_id")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, $Float64, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.EventId = (y >> 0);
			}
		}
		x$1 = (_entry$1 = source[$String.keyFor("identity_name")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			_tuple$1 = $assertType(x$1, $String, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.IdentityName = y$1;
			}
		}
		x$2 = (_entry$2 = source[$String.keyFor("identity_type")], _entry$2 !== undefined ? _entry$2.v : $ifaceNil);
		if (!($interfaceIsEqual(x$2, $ifaceNil))) {
			_tuple$2 = $assertType(x$2, $String, true);
			y$2 = _tuple$2[0];
			ok$2 = _tuple$2[1];
			if (ok$2) {
				target.IdentityType = y$2;
			}
		}
		return $ifaceNil;
	};
	IdentityDeleted.prototype.Init = function(clientEvent) { return this.$val.Init(clientEvent); };
	IdentityDeleted.ptr.prototype.Id = function() {
		var $ptr, event;
		event = this;
		return event.EventId;
	};
	IdentityDeleted.prototype.Id = function() { return this.$val.Id(); };
	IdentityDeleted.ptr.prototype.String = function() {
		var $ptr;
		return "identity_deleted";
	};
	IdentityDeleted.prototype.String = function() { return this.$val.String(); };
	IdentityFound.ptr.prototype.Init = function(clientEvent) {
		var $ptr, _entry, _entry$1, _entry$2, _entry$3, _entry$4, _tuple, _tuple$1, _tuple$2, _tuple$3, _tuple$4, clientEvent, ok, ok$1, ok$2, ok$3, ok$4, source, target, x, x$1, x$2, x$3, x$4, y, y$1, y$2, y$3, y$4;
		target = this;
		if (!(clientEvent.String() === "identity_found")) {
			return new UnexpectedEventError.ptr(clientEvent);
		}
		source = clientEvent.Params;
		x = (_entry = source[$String.keyFor("event_id")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, $Float64, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.EventId = (y >> 0);
			}
		}
		x$1 = (_entry$1 = source[$String.keyFor("identity_attrs")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			_tuple$1 = $assertType(x$1, mapType, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.IdentityAttrs = NewIdentityAttrs(y$1);
			}
		}
		x$2 = (_entry$2 = source[$String.keyFor("identity_name")], _entry$2 !== undefined ? _entry$2.v : $ifaceNil);
		if (!($interfaceIsEqual(x$2, $ifaceNil))) {
			_tuple$2 = $assertType(x$2, $String, true);
			y$2 = _tuple$2[0];
			ok$2 = _tuple$2[1];
			if (ok$2) {
				target.IdentityName = y$2;
			}
		}
		x$3 = (_entry$3 = source[$String.keyFor("identity_type")], _entry$3 !== undefined ? _entry$3.v : $ifaceNil);
		if (!($interfaceIsEqual(x$3, $ifaceNil))) {
			_tuple$3 = $assertType(x$3, $String, true);
			y$3 = _tuple$3[0];
			ok$3 = _tuple$3[1];
			if (ok$3) {
				target.IdentityType = y$3;
			}
		}
		x$4 = (_entry$4 = source[$String.keyFor("user_id")], _entry$4 !== undefined ? _entry$4.v : $ifaceNil);
		if (!($interfaceIsEqual(x$4, $ifaceNil))) {
			_tuple$4 = $assertType(x$4, $String, true);
			y$4 = _tuple$4[0];
			ok$4 = _tuple$4[1];
			if (ok$4) {
				target.UserId = y$4;
			}
		}
		return $ifaceNil;
	};
	IdentityFound.prototype.Init = function(clientEvent) { return this.$val.Init(clientEvent); };
	IdentityFound.ptr.prototype.Id = function() {
		var $ptr, event;
		event = this;
		return event.EventId;
	};
	IdentityFound.prototype.Id = function() { return this.$val.Id(); };
	IdentityFound.ptr.prototype.String = function() {
		var $ptr;
		return "identity_found";
	};
	IdentityFound.prototype.String = function() { return this.$val.String(); };
	IdentityUpdated.ptr.prototype.Init = function(clientEvent) {
		var $ptr, _entry, _entry$1, _entry$2, _entry$3, _tuple, _tuple$1, _tuple$2, _tuple$3, clientEvent, ok, ok$1, ok$2, ok$3, source, target, x, x$1, x$2, x$3, y, y$1, y$2, y$3;
		target = this;
		if (!(clientEvent.String() === "identity_updated")) {
			return new UnexpectedEventError.ptr(clientEvent);
		}
		source = clientEvent.Params;
		x = (_entry = source[$String.keyFor("event_id")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, $Float64, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.EventId = (y >> 0);
			}
		}
		x$1 = (_entry$1 = source[$String.keyFor("identity_attrs")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			_tuple$1 = $assertType(x$1, mapType, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.IdentityAttrs = NewIdentityAttrs(y$1);
			}
		}
		x$2 = (_entry$2 = source[$String.keyFor("identity_name")], _entry$2 !== undefined ? _entry$2.v : $ifaceNil);
		if (!($interfaceIsEqual(x$2, $ifaceNil))) {
			_tuple$2 = $assertType(x$2, $String, true);
			y$2 = _tuple$2[0];
			ok$2 = _tuple$2[1];
			if (ok$2) {
				target.IdentityName = y$2;
			}
		}
		x$3 = (_entry$3 = source[$String.keyFor("identity_type")], _entry$3 !== undefined ? _entry$3.v : $ifaceNil);
		if (!($interfaceIsEqual(x$3, $ifaceNil))) {
			_tuple$3 = $assertType(x$3, $String, true);
			y$3 = _tuple$3[0];
			ok$3 = _tuple$3[1];
			if (ok$3) {
				target.IdentityType = y$3;
			}
		}
		return $ifaceNil;
	};
	IdentityUpdated.prototype.Init = function(clientEvent) { return this.$val.Init(clientEvent); };
	IdentityUpdated.ptr.prototype.Id = function() {
		var $ptr, event;
		event = this;
		return event.EventId;
	};
	IdentityUpdated.prototype.Id = function() { return this.$val.Id(); };
	IdentityUpdated.ptr.prototype.String = function() {
		var $ptr;
		return "identity_updated";
	};
	IdentityUpdated.prototype.String = function() { return this.$val.String(); };
	MasterKeyCreated.ptr.prototype.Init = function(clientEvent) {
		var $ptr, _entry, _entry$1, _entry$2, _entry$3, _tuple, _tuple$1, _tuple$2, _tuple$3, clientEvent, ok, ok$1, ok$2, ok$3, source, target, x, x$1, x$2, x$3, y, y$1, y$2, y$24ptr, y$3;
		target = this;
		if (!(clientEvent.String() === "master_key_created")) {
			return new UnexpectedEventError.ptr(clientEvent);
		}
		source = clientEvent.Params;
		x = (_entry = source[$String.keyFor("event_id")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, $Float64, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.EventId = (y >> 0);
			}
		}
		x$1 = (_entry$1 = source[$String.keyFor("master_key_id")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			_tuple$1 = $assertType(x$1, $String, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.MasterKeyId = y$1;
			}
		}
		x$2 = (_entry$2 = source[$String.keyFor("master_key_secret")], _entry$2 !== undefined ? _entry$2.v : $ifaceNil);
		if (!($interfaceIsEqual(x$2, $ifaceNil))) {
			_tuple$2 = $assertType(x$2, $String, true);
			y$2 = _tuple$2[0];
			ok$2 = _tuple$2[1];
			if (ok$2) {
				target.MasterKeySecret = (y$24ptr || (y$24ptr = new ptrType(function() { return y$2; }, function($v) { y$2 = $v; })));
			}
		}
		x$3 = (_entry$3 = source[$String.keyFor("master_key_type")], _entry$3 !== undefined ? _entry$3.v : $ifaceNil);
		if (!($interfaceIsEqual(x$3, $ifaceNil))) {
			_tuple$3 = $assertType(x$3, $String, true);
			y$3 = _tuple$3[0];
			ok$3 = _tuple$3[1];
			if (ok$3) {
				target.MasterKeyType = y$3;
			}
		}
		return $ifaceNil;
	};
	MasterKeyCreated.prototype.Init = function(clientEvent) { return this.$val.Init(clientEvent); };
	MasterKeyCreated.ptr.prototype.Id = function() {
		var $ptr, event;
		event = this;
		return event.EventId;
	};
	MasterKeyCreated.prototype.Id = function() { return this.$val.Id(); };
	MasterKeyCreated.ptr.prototype.String = function() {
		var $ptr;
		return "master_key_created";
	};
	MasterKeyCreated.prototype.String = function() { return this.$val.String(); };
	MasterKeyDeleted.ptr.prototype.Init = function(clientEvent) {
		var $ptr, _entry, _entry$1, _entry$2, _tuple, _tuple$1, _tuple$2, clientEvent, ok, ok$1, ok$2, source, target, x, x$1, x$2, y, y$1, y$2;
		target = this;
		if (!(clientEvent.String() === "master_key_deleted")) {
			return new UnexpectedEventError.ptr(clientEvent);
		}
		source = clientEvent.Params;
		x = (_entry = source[$String.keyFor("event_id")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, $Float64, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.EventId = (y >> 0);
			}
		}
		x$1 = (_entry$1 = source[$String.keyFor("master_key_id")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			_tuple$1 = $assertType(x$1, $String, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.MasterKeyId = y$1;
			}
		}
		x$2 = (_entry$2 = source[$String.keyFor("master_key_type")], _entry$2 !== undefined ? _entry$2.v : $ifaceNil);
		if (!($interfaceIsEqual(x$2, $ifaceNil))) {
			_tuple$2 = $assertType(x$2, $String, true);
			y$2 = _tuple$2[0];
			ok$2 = _tuple$2[1];
			if (ok$2) {
				target.MasterKeyType = y$2;
			}
		}
		return $ifaceNil;
	};
	MasterKeyDeleted.prototype.Init = function(clientEvent) { return this.$val.Init(clientEvent); };
	MasterKeyDeleted.ptr.prototype.Id = function() {
		var $ptr, event;
		event = this;
		return event.EventId;
	};
	MasterKeyDeleted.prototype.Id = function() { return this.$val.Id(); };
	MasterKeyDeleted.ptr.prototype.String = function() {
		var $ptr;
		return "master_key_deleted";
	};
	MasterKeyDeleted.prototype.String = function() { return this.$val.String(); };
	MasterKeysFound.ptr.prototype.Init = function(clientEvent) {
		var $ptr, _entry, _entry$1, _tuple, _tuple$1, clientEvent, ok, ok$1, source, target, x, x$1, y, y$1;
		target = this;
		if (!(clientEvent.String() === "master_keys_found")) {
			return new UnexpectedEventError.ptr(clientEvent);
		}
		source = clientEvent.Params;
		x = (_entry = source[$String.keyFor("event_id")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, $Float64, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.EventId = (y >> 0);
			}
		}
		x$1 = (_entry$1 = source[$String.keyFor("master_keys")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			_tuple$1 = $assertType(x$1, mapType, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.MasterKeys = MakeMasterKeys(y$1);
			}
		}
		return $ifaceNil;
	};
	MasterKeysFound.prototype.Init = function(clientEvent) { return this.$val.Init(clientEvent); };
	MasterKeysFound.ptr.prototype.Id = function() {
		var $ptr, event;
		event = this;
		return event.EventId;
	};
	MasterKeysFound.prototype.Id = function() { return this.$val.Id(); };
	MasterKeysFound.ptr.prototype.String = function() {
		var $ptr;
		return "master_keys_found";
	};
	MasterKeysFound.prototype.String = function() { return this.$val.String(); };
	MessageReceived.ptr.prototype.Init = function(clientEvent) {
		var $ptr, _entry, _entry$1, _entry$10, _entry$11, _entry$12, _entry$2, _entry$3, _entry$4, _entry$5, _entry$6, _entry$7, _entry$8, _entry$9, _tuple, _tuple$1, _tuple$10, _tuple$2, _tuple$3, _tuple$4, _tuple$5, _tuple$6, _tuple$7, _tuple$8, _tuple$9, clientEvent, ok, ok$1, ok$10, ok$2, ok$3, ok$4, ok$5, ok$6, ok$7, ok$8, ok$9, source, target, x, x$1, x$10, x$11, x$12, x$2, x$3, x$4, x$5, x$6, x$7, x$8, x$9, y, y$1, y$10, y$2, y$24ptr, y$24ptr$1, y$24ptr$2, y$24ptr$3, y$24ptr$4, y$3, y$4, y$5, y$6, y$7, y$8, y$9;
		target = this;
		if (!(clientEvent.String() === "message_received")) {
			return new UnexpectedEventError.ptr(clientEvent);
		}
		source = clientEvent.Params;
		x = (_entry = source[$String.keyFor("channel_id")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, $String, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.ChannelId = (y$24ptr || (y$24ptr = new ptrType(function() { return y; }, function($v) { y = $v; })));
			}
		}
		x$1 = (_entry$1 = source[$String.keyFor("event_id")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			_tuple$1 = $assertType(x$1, $Float64, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.EventId = (y$1 >> 0);
			}
		}
		x$2 = (_entry$2 = source[$String.keyFor("history_length")], _entry$2 !== undefined ? _entry$2.v : $ifaceNil);
		if (!($interfaceIsEqual(x$2, $ifaceNil))) {
			_tuple$2 = $assertType(x$2, $Float64, true);
			y$2 = _tuple$2[0];
			ok$2 = _tuple$2[1];
			if (ok$2) {
				target.HistoryLength = intPointer(y$2);
			}
		}
		x$3 = (_entry$3 = source[$String.keyFor("message_fold")], _entry$3 !== undefined ? _entry$3.v : $ifaceNil);
		if (!($interfaceIsEqual(x$3, $ifaceNil))) {
			target.MessageFold = true;
		}
		x$4 = (_entry$4 = source[$String.keyFor("message_hidden")], _entry$4 !== undefined ? _entry$4.v : $ifaceNil);
		if (!($interfaceIsEqual(x$4, $ifaceNil))) {
			target.MessageHidden = true;
		}
		x$5 = (_entry$5 = source[$String.keyFor("message_id")], _entry$5 !== undefined ? _entry$5.v : $ifaceNil);
		if (!($interfaceIsEqual(x$5, $ifaceNil))) {
			_tuple$3 = $assertType(x$5, $String, true);
			y$3 = _tuple$3[0];
			ok$3 = _tuple$3[1];
			if (ok$3) {
				target.MessageId = y$3;
			}
		}
		x$6 = (_entry$6 = source[$String.keyFor("message_recipient_ids")], _entry$6 !== undefined ? _entry$6.v : $ifaceNil);
		if (!($interfaceIsEqual(x$6, $ifaceNil))) {
			_tuple$4 = $assertType(x$6, sliceType$4, true);
			y$4 = _tuple$4[0];
			ok$4 = _tuple$4[1];
			if (ok$4) {
				target.MessageRecipientIds = AppendStrings(sliceType.nil, y$4);
			}
		}
		x$7 = (_entry$7 = source[$String.keyFor("message_time")], _entry$7 !== undefined ? _entry$7.v : $ifaceNil);
		if (!($interfaceIsEqual(x$7, $ifaceNil))) {
			_tuple$5 = $assertType(x$7, $Float64, true);
			y$5 = _tuple$5[0];
			ok$5 = _tuple$5[1];
			if (ok$5) {
				target.MessageTime = y$5;
			}
		}
		x$8 = (_entry$8 = source[$String.keyFor("message_ttl")], _entry$8 !== undefined ? _entry$8.v : $ifaceNil);
		if (!($interfaceIsEqual(x$8, $ifaceNil))) {
			_tuple$6 = $assertType(x$8, $Float64, true);
			y$6 = _tuple$6[0];
			ok$6 = _tuple$6[1];
			if (ok$6) {
				target.MessageTtl = (y$24ptr$1 || (y$24ptr$1 = new ptrType$9(function() { return y$6; }, function($v) { y$6 = $v; })));
			}
		}
		x$9 = (_entry$9 = source[$String.keyFor("message_type")], _entry$9 !== undefined ? _entry$9.v : $ifaceNil);
		if (!($interfaceIsEqual(x$9, $ifaceNil))) {
			_tuple$7 = $assertType(x$9, $String, true);
			y$7 = _tuple$7[0];
			ok$7 = _tuple$7[1];
			if (ok$7) {
				target.MessageType = y$7;
			}
		}
		x$10 = (_entry$10 = source[$String.keyFor("message_user_id")], _entry$10 !== undefined ? _entry$10.v : $ifaceNil);
		if (!($interfaceIsEqual(x$10, $ifaceNil))) {
			_tuple$8 = $assertType(x$10, $String, true);
			y$8 = _tuple$8[0];
			ok$8 = _tuple$8[1];
			if (ok$8) {
				target.MessageUserId = (y$24ptr$2 || (y$24ptr$2 = new ptrType(function() { return y$8; }, function($v) { y$8 = $v; })));
			}
		}
		x$11 = (_entry$11 = source[$String.keyFor("message_user_name")], _entry$11 !== undefined ? _entry$11.v : $ifaceNil);
		if (!($interfaceIsEqual(x$11, $ifaceNil))) {
			_tuple$9 = $assertType(x$11, $String, true);
			y$9 = _tuple$9[0];
			ok$9 = _tuple$9[1];
			if (ok$9) {
				target.MessageUserName = (y$24ptr$3 || (y$24ptr$3 = new ptrType(function() { return y$9; }, function($v) { y$9 = $v; })));
			}
		}
		x$12 = (_entry$12 = source[$String.keyFor("user_id")], _entry$12 !== undefined ? _entry$12.v : $ifaceNil);
		if (!($interfaceIsEqual(x$12, $ifaceNil))) {
			_tuple$10 = $assertType(x$12, $String, true);
			y$10 = _tuple$10[0];
			ok$10 = _tuple$10[1];
			if (ok$10) {
				target.UserId = (y$24ptr$4 || (y$24ptr$4 = new ptrType(function() { return y$10; }, function($v) { y$10 = $v; })));
			}
		}
		target.InitPayload(clientEvent.Payload);
		return $ifaceNil;
	};
	MessageReceived.prototype.Init = function(clientEvent) { return this.$val.Init(clientEvent); };
	MessageReceived.ptr.prototype.InitPayload = function(payload) {
		var $ptr, event, payload;
		event = this;
		event.payload = payload;
	};
	MessageReceived.prototype.InitPayload = function(payload) { return this.$val.InitPayload(payload); };
	MessageReceived.ptr.prototype.Payload = function() {
		var $ptr, event;
		event = this;
		return event.payload;
	};
	MessageReceived.prototype.Payload = function() { return this.$val.Payload(); };
	MessageReceived.ptr.prototype.Id = function() {
		var $ptr, event;
		event = this;
		return event.EventId;
	};
	MessageReceived.prototype.Id = function() { return this.$val.Id(); };
	MessageReceived.ptr.prototype.String = function() {
		var $ptr;
		return "message_received";
	};
	MessageReceived.prototype.String = function() { return this.$val.String(); };
	MessageUpdated.ptr.prototype.Init = function(clientEvent) {
		var $ptr, _entry, _entry$1, _entry$2, _entry$3, _tuple, _tuple$1, _tuple$2, clientEvent, ok, ok$1, ok$2, source, target, x, x$1, x$2, x$3, y, y$1, y$2, y$24ptr;
		target = this;
		if (!(clientEvent.String() === "message_updated")) {
			return new UnexpectedEventError.ptr(clientEvent);
		}
		source = clientEvent.Params;
		x = (_entry = source[$String.keyFor("channel_id")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, $String, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.ChannelId = (y$24ptr || (y$24ptr = new ptrType(function() { return y; }, function($v) { y = $v; })));
			}
		}
		x$1 = (_entry$1 = source[$String.keyFor("event_id")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			_tuple$1 = $assertType(x$1, $Float64, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.EventId = (y$1 >> 0);
			}
		}
		x$2 = (_entry$2 = source[$String.keyFor("message_hidden")], _entry$2 !== undefined ? _entry$2.v : $ifaceNil);
		if (!($interfaceIsEqual(x$2, $ifaceNil))) {
			target.MessageHidden = true;
		}
		x$3 = (_entry$3 = source[$String.keyFor("message_id")], _entry$3 !== undefined ? _entry$3.v : $ifaceNil);
		if (!($interfaceIsEqual(x$3, $ifaceNil))) {
			_tuple$2 = $assertType(x$3, $String, true);
			y$2 = _tuple$2[0];
			ok$2 = _tuple$2[1];
			if (ok$2) {
				target.MessageId = y$2;
			}
		}
		return $ifaceNil;
	};
	MessageUpdated.prototype.Init = function(clientEvent) { return this.$val.Init(clientEvent); };
	MessageUpdated.ptr.prototype.Id = function() {
		var $ptr, event;
		event = this;
		return event.EventId;
	};
	MessageUpdated.prototype.Id = function() { return this.$val.Id(); };
	MessageUpdated.ptr.prototype.String = function() {
		var $ptr;
		return "message_updated";
	};
	MessageUpdated.prototype.String = function() { return this.$val.String(); };
	Pong.ptr.prototype.Init = function(clientEvent) {
		var $ptr, _entry, _tuple, clientEvent, ok, source, target, x, y;
		target = this;
		if (!(clientEvent.String() === "pong")) {
			return new UnexpectedEventError.ptr(clientEvent);
		}
		source = clientEvent.Params;
		x = (_entry = source[$String.keyFor("event_id")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, $Float64, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.EventId = (y >> 0);
			}
		}
		return $ifaceNil;
	};
	Pong.prototype.Init = function(clientEvent) { return this.$val.Init(clientEvent); };
	Pong.ptr.prototype.Id = function() {
		var $ptr, event;
		event = this;
		return event.EventId;
	};
	Pong.prototype.Id = function() { return this.$val.Id(); };
	Pong.ptr.prototype.String = function() {
		var $ptr;
		return "pong";
	};
	Pong.prototype.String = function() { return this.$val.String(); };
	QueueCreated.ptr.prototype.Init = function(clientEvent) {
		var $ptr, _entry, _entry$1, _entry$2, _entry$3, _tuple, _tuple$1, _tuple$2, _tuple$3, clientEvent, ok, ok$1, ok$2, ok$3, source, target, x, x$1, x$2, x$3, y, y$1, y$2, y$24ptr, y$3;
		target = this;
		if (!(clientEvent.String() === "queue_created")) {
			return new UnexpectedEventError.ptr(clientEvent);
		}
		source = clientEvent.Params;
		x = (_entry = source[$String.keyFor("event_id")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, $Float64, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.EventId = (y >> 0);
			}
		}
		x$1 = (_entry$1 = source[$String.keyFor("queue_attrs")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			_tuple$1 = $assertType(x$1, mapType, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.QueueAttrs = NewQueueAttrs(y$1);
			}
		}
		x$2 = (_entry$2 = source[$String.keyFor("queue_id")], _entry$2 !== undefined ? _entry$2.v : $ifaceNil);
		if (!($interfaceIsEqual(x$2, $ifaceNil))) {
			_tuple$2 = $assertType(x$2, $String, true);
			y$2 = _tuple$2[0];
			ok$2 = _tuple$2[1];
			if (ok$2) {
				target.QueueId = y$2;
			}
		}
		x$3 = (_entry$3 = source[$String.keyFor("realm_id")], _entry$3 !== undefined ? _entry$3.v : $ifaceNil);
		if (!($interfaceIsEqual(x$3, $ifaceNil))) {
			_tuple$3 = $assertType(x$3, $String, true);
			y$3 = _tuple$3[0];
			ok$3 = _tuple$3[1];
			if (ok$3) {
				target.RealmId = (y$24ptr || (y$24ptr = new ptrType(function() { return y$3; }, function($v) { y$3 = $v; })));
			}
		}
		return $ifaceNil;
	};
	QueueCreated.prototype.Init = function(clientEvent) { return this.$val.Init(clientEvent); };
	QueueCreated.ptr.prototype.Id = function() {
		var $ptr, event;
		event = this;
		return event.EventId;
	};
	QueueCreated.prototype.Id = function() { return this.$val.Id(); };
	QueueCreated.ptr.prototype.String = function() {
		var $ptr;
		return "queue_created";
	};
	QueueCreated.prototype.String = function() { return this.$val.String(); };
	QueueDeleted.ptr.prototype.Init = function(clientEvent) {
		var $ptr, _entry, _entry$1, _entry$2, _tuple, _tuple$1, _tuple$2, clientEvent, ok, ok$1, ok$2, source, target, x, x$1, x$2, y, y$1, y$2, y$24ptr;
		target = this;
		if (!(clientEvent.String() === "queue_deleted")) {
			return new UnexpectedEventError.ptr(clientEvent);
		}
		source = clientEvent.Params;
		x = (_entry = source[$String.keyFor("event_id")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, $Float64, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.EventId = (y >> 0);
			}
		}
		x$1 = (_entry$1 = source[$String.keyFor("queue_id")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			_tuple$1 = $assertType(x$1, $String, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.QueueId = y$1;
			}
		}
		x$2 = (_entry$2 = source[$String.keyFor("realm_id")], _entry$2 !== undefined ? _entry$2.v : $ifaceNil);
		if (!($interfaceIsEqual(x$2, $ifaceNil))) {
			_tuple$2 = $assertType(x$2, $String, true);
			y$2 = _tuple$2[0];
			ok$2 = _tuple$2[1];
			if (ok$2) {
				target.RealmId = (y$24ptr || (y$24ptr = new ptrType(function() { return y$2; }, function($v) { y$2 = $v; })));
			}
		}
		return $ifaceNil;
	};
	QueueDeleted.prototype.Init = function(clientEvent) { return this.$val.Init(clientEvent); };
	QueueDeleted.ptr.prototype.Id = function() {
		var $ptr, event;
		event = this;
		return event.EventId;
	};
	QueueDeleted.prototype.Id = function() { return this.$val.Id(); };
	QueueDeleted.ptr.prototype.String = function() {
		var $ptr;
		return "queue_deleted";
	};
	QueueDeleted.prototype.String = function() { return this.$val.String(); };
	QueueFound.ptr.prototype.Init = function(clientEvent) {
		var $ptr, _entry, _entry$1, _entry$2, _entry$3, _entry$4, _entry$5, _tuple, _tuple$1, _tuple$2, _tuple$3, _tuple$4, _tuple$5, clientEvent, ok, ok$1, ok$2, ok$3, ok$4, ok$5, source, target, x, x$1, x$2, x$3, x$4, x$5, y, y$1, y$2, y$24ptr, y$3, y$4, y$5;
		target = this;
		if (!(clientEvent.String() === "queue_found")) {
			return new UnexpectedEventError.ptr(clientEvent);
		}
		source = clientEvent.Params;
		x = (_entry = source[$String.keyFor("event_id")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, $Float64, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.EventId = (y >> 0);
			}
		}
		x$1 = (_entry$1 = source[$String.keyFor("queue_attrs")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			_tuple$1 = $assertType(x$1, mapType, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.QueueAttrs = NewQueueAttrs(y$1);
			}
		}
		x$2 = (_entry$2 = source[$String.keyFor("queue_id")], _entry$2 !== undefined ? _entry$2.v : $ifaceNil);
		if (!($interfaceIsEqual(x$2, $ifaceNil))) {
			_tuple$2 = $assertType(x$2, $String, true);
			y$2 = _tuple$2[0];
			ok$2 = _tuple$2[1];
			if (ok$2) {
				target.QueueId = y$2;
			}
		}
		x$3 = (_entry$3 = source[$String.keyFor("queue_members")], _entry$3 !== undefined ? _entry$3.v : $ifaceNil);
		if (!($interfaceIsEqual(x$3, $ifaceNil))) {
			_tuple$3 = $assertType(x$3, mapType, true);
			y$3 = _tuple$3[0];
			ok$3 = _tuple$3[1];
			if (ok$3) {
				target.QueueMembers = MakeQueueMembers(y$3);
			}
		}
		x$4 = (_entry$4 = source[$String.keyFor("queue_position")], _entry$4 !== undefined ? _entry$4.v : $ifaceNil);
		if (!($interfaceIsEqual(x$4, $ifaceNil))) {
			_tuple$4 = $assertType(x$4, $Float64, true);
			y$4 = _tuple$4[0];
			ok$4 = _tuple$4[1];
			if (ok$4) {
				target.QueuePosition = intPointer(y$4);
			}
		}
		x$5 = (_entry$5 = source[$String.keyFor("realm_id")], _entry$5 !== undefined ? _entry$5.v : $ifaceNil);
		if (!($interfaceIsEqual(x$5, $ifaceNil))) {
			_tuple$5 = $assertType(x$5, $String, true);
			y$5 = _tuple$5[0];
			ok$5 = _tuple$5[1];
			if (ok$5) {
				target.RealmId = (y$24ptr || (y$24ptr = new ptrType(function() { return y$5; }, function($v) { y$5 = $v; })));
			}
		}
		return $ifaceNil;
	};
	QueueFound.prototype.Init = function(clientEvent) { return this.$val.Init(clientEvent); };
	QueueFound.ptr.prototype.Id = function() {
		var $ptr, event;
		event = this;
		return event.EventId;
	};
	QueueFound.prototype.Id = function() { return this.$val.Id(); };
	QueueFound.ptr.prototype.String = function() {
		var $ptr;
		return "queue_found";
	};
	QueueFound.prototype.String = function() { return this.$val.String(); };
	QueueJoined.ptr.prototype.Init = function(clientEvent) {
		var $ptr, _entry, _entry$1, _entry$2, _entry$3, _tuple, _tuple$1, _tuple$2, _tuple$3, clientEvent, ok, ok$1, ok$2, ok$3, source, target, x, x$1, x$2, x$3, y, y$1, y$2, y$24ptr, y$3;
		target = this;
		if (!(clientEvent.String() === "queue_joined")) {
			return new UnexpectedEventError.ptr(clientEvent);
		}
		source = clientEvent.Params;
		x = (_entry = source[$String.keyFor("event_id")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, $Float64, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.EventId = (y >> 0);
			}
		}
		x$1 = (_entry$1 = source[$String.keyFor("queue_attrs")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			_tuple$1 = $assertType(x$1, mapType, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.QueueAttrs = NewQueueAttrs(y$1);
			}
		}
		x$2 = (_entry$2 = source[$String.keyFor("queue_id")], _entry$2 !== undefined ? _entry$2.v : $ifaceNil);
		if (!($interfaceIsEqual(x$2, $ifaceNil))) {
			_tuple$2 = $assertType(x$2, $String, true);
			y$2 = _tuple$2[0];
			ok$2 = _tuple$2[1];
			if (ok$2) {
				target.QueueId = y$2;
			}
		}
		x$3 = (_entry$3 = source[$String.keyFor("realm_id")], _entry$3 !== undefined ? _entry$3.v : $ifaceNil);
		if (!($interfaceIsEqual(x$3, $ifaceNil))) {
			_tuple$3 = $assertType(x$3, $String, true);
			y$3 = _tuple$3[0];
			ok$3 = _tuple$3[1];
			if (ok$3) {
				target.RealmId = (y$24ptr || (y$24ptr = new ptrType(function() { return y$3; }, function($v) { y$3 = $v; })));
			}
		}
		return $ifaceNil;
	};
	QueueJoined.prototype.Init = function(clientEvent) { return this.$val.Init(clientEvent); };
	QueueJoined.ptr.prototype.Id = function() {
		var $ptr, event;
		event = this;
		return event.EventId;
	};
	QueueJoined.prototype.Id = function() { return this.$val.Id(); };
	QueueJoined.ptr.prototype.String = function() {
		var $ptr;
		return "queue_joined";
	};
	QueueJoined.prototype.String = function() { return this.$val.String(); };
	QueueMemberJoined.ptr.prototype.Init = function(clientEvent) {
		var $ptr, _entry, _entry$1, _entry$2, _entry$3, _entry$4, _tuple, _tuple$1, _tuple$2, _tuple$3, _tuple$4, clientEvent, ok, ok$1, ok$2, ok$3, ok$4, source, target, x, x$1, x$2, x$3, x$4, y, y$1, y$2, y$3, y$4;
		target = this;
		if (!(clientEvent.String() === "queue_member_joined")) {
			return new UnexpectedEventError.ptr(clientEvent);
		}
		source = clientEvent.Params;
		x = (_entry = source[$String.keyFor("event_id")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, $Float64, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.EventId = (y >> 0);
			}
		}
		x$1 = (_entry$1 = source[$String.keyFor("member_attrs")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			_tuple$1 = $assertType(x$1, mapType, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.MemberAttrs = NewQueueMemberAttrs(y$1);
			}
		}
		x$2 = (_entry$2 = source[$String.keyFor("queue_id")], _entry$2 !== undefined ? _entry$2.v : $ifaceNil);
		if (!($interfaceIsEqual(x$2, $ifaceNil))) {
			_tuple$2 = $assertType(x$2, $String, true);
			y$2 = _tuple$2[0];
			ok$2 = _tuple$2[1];
			if (ok$2) {
				target.QueueId = y$2;
			}
		}
		x$3 = (_entry$3 = source[$String.keyFor("user_attrs")], _entry$3 !== undefined ? _entry$3.v : $ifaceNil);
		if (!($interfaceIsEqual(x$3, $ifaceNil))) {
			_tuple$3 = $assertType(x$3, mapType, true);
			y$3 = _tuple$3[0];
			ok$3 = _tuple$3[1];
			if (ok$3) {
				target.UserAttrs = NewUserAttrs(y$3);
			}
		}
		x$4 = (_entry$4 = source[$String.keyFor("user_id")], _entry$4 !== undefined ? _entry$4.v : $ifaceNil);
		if (!($interfaceIsEqual(x$4, $ifaceNil))) {
			_tuple$4 = $assertType(x$4, $String, true);
			y$4 = _tuple$4[0];
			ok$4 = _tuple$4[1];
			if (ok$4) {
				target.UserId = y$4;
			}
		}
		return $ifaceNil;
	};
	QueueMemberJoined.prototype.Init = function(clientEvent) { return this.$val.Init(clientEvent); };
	QueueMemberJoined.ptr.prototype.Id = function() {
		var $ptr, event;
		event = this;
		return event.EventId;
	};
	QueueMemberJoined.prototype.Id = function() { return this.$val.Id(); };
	QueueMemberJoined.ptr.prototype.String = function() {
		var $ptr;
		return "queue_member_joined";
	};
	QueueMemberJoined.prototype.String = function() { return this.$val.String(); };
	QueueMemberParted.ptr.prototype.Init = function(clientEvent) {
		var $ptr, _entry, _entry$1, _entry$2, _tuple, _tuple$1, _tuple$2, clientEvent, ok, ok$1, ok$2, source, target, x, x$1, x$2, y, y$1, y$2;
		target = this;
		if (!(clientEvent.String() === "queue_member_parted")) {
			return new UnexpectedEventError.ptr(clientEvent);
		}
		source = clientEvent.Params;
		x = (_entry = source[$String.keyFor("event_id")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, $Float64, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.EventId = (y >> 0);
			}
		}
		x$1 = (_entry$1 = source[$String.keyFor("queue_id")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			_tuple$1 = $assertType(x$1, $String, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.QueueId = y$1;
			}
		}
		x$2 = (_entry$2 = source[$String.keyFor("user_id")], _entry$2 !== undefined ? _entry$2.v : $ifaceNil);
		if (!($interfaceIsEqual(x$2, $ifaceNil))) {
			_tuple$2 = $assertType(x$2, $String, true);
			y$2 = _tuple$2[0];
			ok$2 = _tuple$2[1];
			if (ok$2) {
				target.UserId = y$2;
			}
		}
		return $ifaceNil;
	};
	QueueMemberParted.prototype.Init = function(clientEvent) { return this.$val.Init(clientEvent); };
	QueueMemberParted.ptr.prototype.Id = function() {
		var $ptr, event;
		event = this;
		return event.EventId;
	};
	QueueMemberParted.prototype.Id = function() { return this.$val.Id(); };
	QueueMemberParted.ptr.prototype.String = function() {
		var $ptr;
		return "queue_member_parted";
	};
	QueueMemberParted.prototype.String = function() { return this.$val.String(); };
	QueueParted.ptr.prototype.Init = function(clientEvent) {
		var $ptr, _entry, _entry$1, _entry$2, _tuple, _tuple$1, _tuple$2, clientEvent, ok, ok$1, ok$2, source, target, x, x$1, x$2, y, y$1, y$2, y$24ptr;
		target = this;
		if (!(clientEvent.String() === "queue_parted")) {
			return new UnexpectedEventError.ptr(clientEvent);
		}
		source = clientEvent.Params;
		x = (_entry = source[$String.keyFor("event_id")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, $Float64, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.EventId = (y >> 0);
			}
		}
		x$1 = (_entry$1 = source[$String.keyFor("queue_id")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			_tuple$1 = $assertType(x$1, $String, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.QueueId = y$1;
			}
		}
		x$2 = (_entry$2 = source[$String.keyFor("realm_id")], _entry$2 !== undefined ? _entry$2.v : $ifaceNil);
		if (!($interfaceIsEqual(x$2, $ifaceNil))) {
			_tuple$2 = $assertType(x$2, $String, true);
			y$2 = _tuple$2[0];
			ok$2 = _tuple$2[1];
			if (ok$2) {
				target.RealmId = (y$24ptr || (y$24ptr = new ptrType(function() { return y$2; }, function($v) { y$2 = $v; })));
			}
		}
		return $ifaceNil;
	};
	QueueParted.prototype.Init = function(clientEvent) { return this.$val.Init(clientEvent); };
	QueueParted.ptr.prototype.Id = function() {
		var $ptr, event;
		event = this;
		return event.EventId;
	};
	QueueParted.prototype.Id = function() { return this.$val.Id(); };
	QueueParted.ptr.prototype.String = function() {
		var $ptr;
		return "queue_parted";
	};
	QueueParted.prototype.String = function() { return this.$val.String(); };
	QueueTranscriptsDeleted.ptr.prototype.Init = function(clientEvent) {
		var $ptr, _entry, _entry$1, _entry$2, _entry$3, _tuple, _tuple$1, _tuple$2, _tuple$3, clientEvent, ok, ok$1, ok$2, ok$3, source, target, x, x$1, x$2, x$3, y, y$1, y$2, y$3;
		target = this;
		if (!(clientEvent.String() === "queue_transcripts_deleted")) {
			return new UnexpectedEventError.ptr(clientEvent);
		}
		source = clientEvent.Params;
		x = (_entry = source[$String.keyFor("event_id")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, $Float64, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.EventId = (y >> 0);
			}
		}
		x$1 = (_entry$1 = source[$String.keyFor("interval_begin")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			_tuple$1 = $assertType(x$1, $Float64, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.IntervalBegin = y$1;
			}
		}
		x$2 = (_entry$2 = source[$String.keyFor("interval_end")], _entry$2 !== undefined ? _entry$2.v : $ifaceNil);
		if (!($interfaceIsEqual(x$2, $ifaceNil))) {
			_tuple$2 = $assertType(x$2, $Float64, true);
			y$2 = _tuple$2[0];
			ok$2 = _tuple$2[1];
			if (ok$2) {
				target.IntervalEnd = y$2;
			}
		}
		x$3 = (_entry$3 = source[$String.keyFor("queue_id")], _entry$3 !== undefined ? _entry$3.v : $ifaceNil);
		if (!($interfaceIsEqual(x$3, $ifaceNil))) {
			_tuple$3 = $assertType(x$3, $String, true);
			y$3 = _tuple$3[0];
			ok$3 = _tuple$3[1];
			if (ok$3) {
				target.QueueId = y$3;
			}
		}
		return $ifaceNil;
	};
	QueueTranscriptsDeleted.prototype.Init = function(clientEvent) { return this.$val.Init(clientEvent); };
	QueueTranscriptsDeleted.ptr.prototype.Id = function() {
		var $ptr, event;
		event = this;
		return event.EventId;
	};
	QueueTranscriptsDeleted.prototype.Id = function() { return this.$val.Id(); };
	QueueTranscriptsDeleted.ptr.prototype.String = function() {
		var $ptr;
		return "queue_transcripts_deleted";
	};
	QueueTranscriptsDeleted.prototype.String = function() { return this.$val.String(); };
	QueueTranscriptsFound.ptr.prototype.Init = function(clientEvent) {
		var $ptr, _entry, _entry$1, _entry$2, _tuple, _tuple$1, _tuple$2, clientEvent, ok, ok$1, ok$2, source, target, x, x$1, x$2, y, y$1, y$2;
		target = this;
		if (!(clientEvent.String() === "queue_transcripts_found")) {
			return new UnexpectedEventError.ptr(clientEvent);
		}
		source = clientEvent.Params;
		x = (_entry = source[$String.keyFor("event_id")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, $Float64, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.EventId = (y >> 0);
			}
		}
		x$1 = (_entry$1 = source[$String.keyFor("queue_id")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			_tuple$1 = $assertType(x$1, $String, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.QueueId = y$1;
			}
		}
		x$2 = (_entry$2 = source[$String.keyFor("queue_transcripts")], _entry$2 !== undefined ? _entry$2.v : $ifaceNil);
		if (!($interfaceIsEqual(x$2, $ifaceNil))) {
			_tuple$2 = $assertType(x$2, sliceType$4, true);
			y$2 = _tuple$2[0];
			ok$2 = _tuple$2[1];
			if (ok$2) {
				target.QueueTranscripts = AppendQueueTranscripts(sliceType$2.nil, y$2);
			}
		}
		return $ifaceNil;
	};
	QueueTranscriptsFound.prototype.Init = function(clientEvent) { return this.$val.Init(clientEvent); };
	QueueTranscriptsFound.ptr.prototype.Id = function() {
		var $ptr, event;
		event = this;
		return event.EventId;
	};
	QueueTranscriptsFound.prototype.Id = function() { return this.$val.Id(); };
	QueueTranscriptsFound.ptr.prototype.String = function() {
		var $ptr;
		return "queue_transcripts_found";
	};
	QueueTranscriptsFound.prototype.String = function() { return this.$val.String(); };
	QueueUpdated.ptr.prototype.Init = function(clientEvent) {
		var $ptr, _entry, _entry$1, _entry$2, _entry$3, _entry$4, _tuple, _tuple$1, _tuple$2, _tuple$3, _tuple$4, clientEvent, ok, ok$1, ok$2, ok$3, ok$4, source, target, x, x$1, x$2, x$3, x$4, y, y$1, y$2, y$24ptr, y$3, y$4;
		target = this;
		if (!(clientEvent.String() === "queue_updated")) {
			return new UnexpectedEventError.ptr(clientEvent);
		}
		source = clientEvent.Params;
		x = (_entry = source[$String.keyFor("event_id")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, $Float64, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.EventId = (y >> 0);
			}
		}
		x$1 = (_entry$1 = source[$String.keyFor("queue_attrs")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			_tuple$1 = $assertType(x$1, mapType, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.QueueAttrs = NewQueueAttrs(y$1);
			}
		}
		x$2 = (_entry$2 = source[$String.keyFor("queue_id")], _entry$2 !== undefined ? _entry$2.v : $ifaceNil);
		if (!($interfaceIsEqual(x$2, $ifaceNil))) {
			_tuple$2 = $assertType(x$2, $String, true);
			y$2 = _tuple$2[0];
			ok$2 = _tuple$2[1];
			if (ok$2) {
				target.QueueId = y$2;
			}
		}
		x$3 = (_entry$3 = source[$String.keyFor("queue_position")], _entry$3 !== undefined ? _entry$3.v : $ifaceNil);
		if (!($interfaceIsEqual(x$3, $ifaceNil))) {
			_tuple$3 = $assertType(x$3, $Float64, true);
			y$3 = _tuple$3[0];
			ok$3 = _tuple$3[1];
			if (ok$3) {
				target.QueuePosition = intPointer(y$3);
			}
		}
		x$4 = (_entry$4 = source[$String.keyFor("realm_id")], _entry$4 !== undefined ? _entry$4.v : $ifaceNil);
		if (!($interfaceIsEqual(x$4, $ifaceNil))) {
			_tuple$4 = $assertType(x$4, $String, true);
			y$4 = _tuple$4[0];
			ok$4 = _tuple$4[1];
			if (ok$4) {
				target.RealmId = (y$24ptr || (y$24ptr = new ptrType(function() { return y$4; }, function($v) { y$4 = $v; })));
			}
		}
		return $ifaceNil;
	};
	QueueUpdated.prototype.Init = function(clientEvent) { return this.$val.Init(clientEvent); };
	QueueUpdated.ptr.prototype.Id = function() {
		var $ptr, event;
		event = this;
		return event.EventId;
	};
	QueueUpdated.prototype.Id = function() { return this.$val.Id(); };
	QueueUpdated.ptr.prototype.String = function() {
		var $ptr;
		return "queue_updated";
	};
	QueueUpdated.prototype.String = function() { return this.$val.String(); };
	RealmDeleted.ptr.prototype.Init = function(clientEvent) {
		var $ptr, _entry, _entry$1, _tuple, _tuple$1, clientEvent, ok, ok$1, source, target, x, x$1, y, y$1;
		target = this;
		if (!(clientEvent.String() === "realm_deleted")) {
			return new UnexpectedEventError.ptr(clientEvent);
		}
		source = clientEvent.Params;
		x = (_entry = source[$String.keyFor("event_id")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, $Float64, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.EventId = (y >> 0);
			}
		}
		x$1 = (_entry$1 = source[$String.keyFor("realm_id")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			_tuple$1 = $assertType(x$1, $String, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.RealmId = y$1;
			}
		}
		return $ifaceNil;
	};
	RealmDeleted.prototype.Init = function(clientEvent) { return this.$val.Init(clientEvent); };
	RealmDeleted.ptr.prototype.Id = function() {
		var $ptr, event;
		event = this;
		return event.EventId;
	};
	RealmDeleted.prototype.Id = function() { return this.$val.Id(); };
	RealmDeleted.ptr.prototype.String = function() {
		var $ptr;
		return "realm_deleted";
	};
	RealmDeleted.prototype.String = function() { return this.$val.String(); };
	RealmFound.ptr.prototype.Init = function(clientEvent) {
		var $ptr, _entry, _entry$1, _entry$2, _entry$3, _tuple, _tuple$1, _tuple$2, _tuple$3, clientEvent, ok, ok$1, ok$2, ok$3, source, target, x, x$1, x$2, x$3, y, y$1, y$2, y$3;
		target = this;
		if (!(clientEvent.String() === "realm_found")) {
			return new UnexpectedEventError.ptr(clientEvent);
		}
		source = clientEvent.Params;
		x = (_entry = source[$String.keyFor("event_id")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, $Float64, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.EventId = (y >> 0);
			}
		}
		x$1 = (_entry$1 = source[$String.keyFor("realm_attrs")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			_tuple$1 = $assertType(x$1, mapType, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.RealmAttrs = NewRealmAttrs(y$1);
			}
		}
		x$2 = (_entry$2 = source[$String.keyFor("realm_id")], _entry$2 !== undefined ? _entry$2.v : $ifaceNil);
		if (!($interfaceIsEqual(x$2, $ifaceNil))) {
			_tuple$2 = $assertType(x$2, $String, true);
			y$2 = _tuple$2[0];
			ok$2 = _tuple$2[1];
			if (ok$2) {
				target.RealmId = y$2;
			}
		}
		x$3 = (_entry$3 = source[$String.keyFor("realm_members")], _entry$3 !== undefined ? _entry$3.v : $ifaceNil);
		if (!($interfaceIsEqual(x$3, $ifaceNil))) {
			_tuple$3 = $assertType(x$3, mapType, true);
			y$3 = _tuple$3[0];
			ok$3 = _tuple$3[1];
			if (ok$3) {
				target.RealmMembers = MakeRealmMembers(y$3);
			}
		}
		return $ifaceNil;
	};
	RealmFound.prototype.Init = function(clientEvent) { return this.$val.Init(clientEvent); };
	RealmFound.ptr.prototype.Id = function() {
		var $ptr, event;
		event = this;
		return event.EventId;
	};
	RealmFound.prototype.Id = function() { return this.$val.Id(); };
	RealmFound.ptr.prototype.String = function() {
		var $ptr;
		return "realm_found";
	};
	RealmFound.prototype.String = function() { return this.$val.String(); };
	RealmJoined.ptr.prototype.Init = function(clientEvent) {
		var $ptr, _entry, _entry$1, _entry$2, _entry$3, _tuple, _tuple$1, _tuple$2, _tuple$3, clientEvent, ok, ok$1, ok$2, ok$3, source, target, x, x$1, x$2, x$3, y, y$1, y$2, y$3;
		target = this;
		if (!(clientEvent.String() === "realm_joined")) {
			return new UnexpectedEventError.ptr(clientEvent);
		}
		source = clientEvent.Params;
		x = (_entry = source[$String.keyFor("event_id")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, $Float64, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.EventId = (y >> 0);
			}
		}
		x$1 = (_entry$1 = source[$String.keyFor("realm_attrs")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			_tuple$1 = $assertType(x$1, mapType, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.RealmAttrs = NewRealmAttrs(y$1);
			}
		}
		x$2 = (_entry$2 = source[$String.keyFor("realm_id")], _entry$2 !== undefined ? _entry$2.v : $ifaceNil);
		if (!($interfaceIsEqual(x$2, $ifaceNil))) {
			_tuple$2 = $assertType(x$2, $String, true);
			y$2 = _tuple$2[0];
			ok$2 = _tuple$2[1];
			if (ok$2) {
				target.RealmId = y$2;
			}
		}
		x$3 = (_entry$3 = source[$String.keyFor("realm_members")], _entry$3 !== undefined ? _entry$3.v : $ifaceNil);
		if (!($interfaceIsEqual(x$3, $ifaceNil))) {
			_tuple$3 = $assertType(x$3, mapType, true);
			y$3 = _tuple$3[0];
			ok$3 = _tuple$3[1];
			if (ok$3) {
				target.RealmMembers = MakeRealmMembers(y$3);
			}
		}
		return $ifaceNil;
	};
	RealmJoined.prototype.Init = function(clientEvent) { return this.$val.Init(clientEvent); };
	RealmJoined.ptr.prototype.Id = function() {
		var $ptr, event;
		event = this;
		return event.EventId;
	};
	RealmJoined.prototype.Id = function() { return this.$val.Id(); };
	RealmJoined.ptr.prototype.String = function() {
		var $ptr;
		return "realm_joined";
	};
	RealmJoined.prototype.String = function() { return this.$val.String(); };
	RealmMemberJoined.ptr.prototype.Init = function(clientEvent) {
		var $ptr, _entry, _entry$1, _entry$2, _entry$3, _entry$4, _entry$5, _tuple, _tuple$1, _tuple$2, _tuple$3, _tuple$4, _tuple$5, clientEvent, ok, ok$1, ok$2, ok$3, ok$4, ok$5, source, target, x, x$1, x$2, x$3, x$4, x$5, y, y$1, y$2, y$3, y$4, y$5;
		target = this;
		if (!(clientEvent.String() === "realm_member_joined")) {
			return new UnexpectedEventError.ptr(clientEvent);
		}
		source = clientEvent.Params;
		x = (_entry = source[$String.keyFor("event_id")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, $Float64, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.EventId = (y >> 0);
			}
		}
		x$1 = (_entry$1 = source[$String.keyFor("member_attrs")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			_tuple$1 = $assertType(x$1, mapType, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.MemberAttrs = NewRealmMemberAttrs(y$1);
			}
		}
		x$2 = (_entry$2 = source[$String.keyFor("puppet_attrs")], _entry$2 !== undefined ? _entry$2.v : $ifaceNil);
		if (!($interfaceIsEqual(x$2, $ifaceNil))) {
			_tuple$2 = $assertType(x$2, mapType, true);
			y$2 = _tuple$2[0];
			ok$2 = _tuple$2[1];
			if (ok$2) {
				target.PuppetAttrs = NewPuppetAttrs(y$2);
			}
		}
		x$3 = (_entry$3 = source[$String.keyFor("realm_id")], _entry$3 !== undefined ? _entry$3.v : $ifaceNil);
		if (!($interfaceIsEqual(x$3, $ifaceNil))) {
			_tuple$3 = $assertType(x$3, $String, true);
			y$3 = _tuple$3[0];
			ok$3 = _tuple$3[1];
			if (ok$3) {
				target.RealmId = y$3;
			}
		}
		x$4 = (_entry$4 = source[$String.keyFor("user_attrs")], _entry$4 !== undefined ? _entry$4.v : $ifaceNil);
		if (!($interfaceIsEqual(x$4, $ifaceNil))) {
			_tuple$4 = $assertType(x$4, mapType, true);
			y$4 = _tuple$4[0];
			ok$4 = _tuple$4[1];
			if (ok$4) {
				target.UserAttrs = NewUserAttrs(y$4);
			}
		}
		x$5 = (_entry$5 = source[$String.keyFor("user_id")], _entry$5 !== undefined ? _entry$5.v : $ifaceNil);
		if (!($interfaceIsEqual(x$5, $ifaceNil))) {
			_tuple$5 = $assertType(x$5, $String, true);
			y$5 = _tuple$5[0];
			ok$5 = _tuple$5[1];
			if (ok$5) {
				target.UserId = y$5;
			}
		}
		return $ifaceNil;
	};
	RealmMemberJoined.prototype.Init = function(clientEvent) { return this.$val.Init(clientEvent); };
	RealmMemberJoined.ptr.prototype.Id = function() {
		var $ptr, event;
		event = this;
		return event.EventId;
	};
	RealmMemberJoined.prototype.Id = function() { return this.$val.Id(); };
	RealmMemberJoined.ptr.prototype.String = function() {
		var $ptr;
		return "realm_member_joined";
	};
	RealmMemberJoined.prototype.String = function() { return this.$val.String(); };
	RealmMemberParted.ptr.prototype.Init = function(clientEvent) {
		var $ptr, _entry, _entry$1, _entry$2, _entry$3, _tuple, _tuple$1, _tuple$2, _tuple$3, clientEvent, ok, ok$1, ok$2, ok$3, source, target, x, x$1, x$2, x$3, y, y$1, y$2, y$24ptr, y$24ptr$1, y$3;
		target = this;
		if (!(clientEvent.String() === "realm_member_parted")) {
			return new UnexpectedEventError.ptr(clientEvent);
		}
		source = clientEvent.Params;
		x = (_entry = source[$String.keyFor("channel_id")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, $String, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.ChannelId = (y$24ptr || (y$24ptr = new ptrType(function() { return y; }, function($v) { y = $v; })));
			}
		}
		x$1 = (_entry$1 = source[$String.keyFor("event_id")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			_tuple$1 = $assertType(x$1, $Float64, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.EventId = (y$1 >> 0);
			}
		}
		x$2 = (_entry$2 = source[$String.keyFor("realm_id")], _entry$2 !== undefined ? _entry$2.v : $ifaceNil);
		if (!($interfaceIsEqual(x$2, $ifaceNil))) {
			_tuple$2 = $assertType(x$2, $String, true);
			y$2 = _tuple$2[0];
			ok$2 = _tuple$2[1];
			if (ok$2) {
				target.RealmId = (y$24ptr$1 || (y$24ptr$1 = new ptrType(function() { return y$2; }, function($v) { y$2 = $v; })));
			}
		}
		x$3 = (_entry$3 = source[$String.keyFor("user_id")], _entry$3 !== undefined ? _entry$3.v : $ifaceNil);
		if (!($interfaceIsEqual(x$3, $ifaceNil))) {
			_tuple$3 = $assertType(x$3, $String, true);
			y$3 = _tuple$3[0];
			ok$3 = _tuple$3[1];
			if (ok$3) {
				target.UserId = y$3;
			}
		}
		return $ifaceNil;
	};
	RealmMemberParted.prototype.Init = function(clientEvent) { return this.$val.Init(clientEvent); };
	RealmMemberParted.ptr.prototype.Id = function() {
		var $ptr, event;
		event = this;
		return event.EventId;
	};
	RealmMemberParted.prototype.Id = function() { return this.$val.Id(); };
	RealmMemberParted.ptr.prototype.String = function() {
		var $ptr;
		return "realm_member_parted";
	};
	RealmMemberParted.prototype.String = function() { return this.$val.String(); };
	RealmMemberUpdated.ptr.prototype.Init = function(clientEvent) {
		var $ptr, _entry, _entry$1, _entry$2, _entry$3, _tuple, _tuple$1, _tuple$2, _tuple$3, clientEvent, ok, ok$1, ok$2, ok$3, source, target, x, x$1, x$2, x$3, y, y$1, y$2, y$3;
		target = this;
		if (!(clientEvent.String() === "realm_member_updated")) {
			return new UnexpectedEventError.ptr(clientEvent);
		}
		source = clientEvent.Params;
		x = (_entry = source[$String.keyFor("event_id")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, $Float64, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.EventId = (y >> 0);
			}
		}
		x$1 = (_entry$1 = source[$String.keyFor("member_attrs")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			_tuple$1 = $assertType(x$1, mapType, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.MemberAttrs = NewRealmMemberAttrs(y$1);
			}
		}
		x$2 = (_entry$2 = source[$String.keyFor("realm_id")], _entry$2 !== undefined ? _entry$2.v : $ifaceNil);
		if (!($interfaceIsEqual(x$2, $ifaceNil))) {
			_tuple$2 = $assertType(x$2, $String, true);
			y$2 = _tuple$2[0];
			ok$2 = _tuple$2[1];
			if (ok$2) {
				target.RealmId = y$2;
			}
		}
		x$3 = (_entry$3 = source[$String.keyFor("user_id")], _entry$3 !== undefined ? _entry$3.v : $ifaceNil);
		if (!($interfaceIsEqual(x$3, $ifaceNil))) {
			_tuple$3 = $assertType(x$3, $String, true);
			y$3 = _tuple$3[0];
			ok$3 = _tuple$3[1];
			if (ok$3) {
				target.UserId = y$3;
			}
		}
		return $ifaceNil;
	};
	RealmMemberUpdated.prototype.Init = function(clientEvent) { return this.$val.Init(clientEvent); };
	RealmMemberUpdated.ptr.prototype.Id = function() {
		var $ptr, event;
		event = this;
		return event.EventId;
	};
	RealmMemberUpdated.prototype.Id = function() { return this.$val.Id(); };
	RealmMemberUpdated.ptr.prototype.String = function() {
		var $ptr;
		return "realm_member_updated";
	};
	RealmMemberUpdated.prototype.String = function() { return this.$val.String(); };
	RealmParted.ptr.prototype.Init = function(clientEvent) {
		var $ptr, _entry, _entry$1, _tuple, _tuple$1, clientEvent, ok, ok$1, source, target, x, x$1, y, y$1;
		target = this;
		if (!(clientEvent.String() === "realm_parted")) {
			return new UnexpectedEventError.ptr(clientEvent);
		}
		source = clientEvent.Params;
		x = (_entry = source[$String.keyFor("event_id")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, $Float64, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.EventId = (y >> 0);
			}
		}
		x$1 = (_entry$1 = source[$String.keyFor("realm_id")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			_tuple$1 = $assertType(x$1, $String, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.RealmId = y$1;
			}
		}
		return $ifaceNil;
	};
	RealmParted.prototype.Init = function(clientEvent) { return this.$val.Init(clientEvent); };
	RealmParted.ptr.prototype.Id = function() {
		var $ptr, event;
		event = this;
		return event.EventId;
	};
	RealmParted.prototype.Id = function() { return this.$val.Id(); };
	RealmParted.ptr.prototype.String = function() {
		var $ptr;
		return "realm_parted";
	};
	RealmParted.prototype.String = function() { return this.$val.String(); };
	RealmQueuesFound.ptr.prototype.Init = function(clientEvent) {
		var $ptr, _entry, _entry$1, _entry$2, _tuple, _tuple$1, _tuple$2, clientEvent, ok, ok$1, ok$2, source, target, x, x$1, x$2, y, y$1, y$2;
		target = this;
		if (!(clientEvent.String() === "realm_queues_found")) {
			return new UnexpectedEventError.ptr(clientEvent);
		}
		source = clientEvent.Params;
		x = (_entry = source[$String.keyFor("event_id")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, $Float64, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.EventId = (y >> 0);
			}
		}
		x$1 = (_entry$1 = source[$String.keyFor("realm_id")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			_tuple$1 = $assertType(x$1, $String, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.RealmId = y$1;
			}
		}
		x$2 = (_entry$2 = source[$String.keyFor("realm_queues")], _entry$2 !== undefined ? _entry$2.v : $ifaceNil);
		if (!($interfaceIsEqual(x$2, $ifaceNil))) {
			_tuple$2 = $assertType(x$2, mapType, true);
			y$2 = _tuple$2[0];
			ok$2 = _tuple$2[1];
			if (ok$2) {
				target.RealmQueues = MakeRealmQueues(y$2);
			}
		}
		return $ifaceNil;
	};
	RealmQueuesFound.prototype.Init = function(clientEvent) { return this.$val.Init(clientEvent); };
	RealmQueuesFound.ptr.prototype.Id = function() {
		var $ptr, event;
		event = this;
		return event.EventId;
	};
	RealmQueuesFound.prototype.Id = function() { return this.$val.Id(); };
	RealmQueuesFound.ptr.prototype.String = function() {
		var $ptr;
		return "realm_queues_found";
	};
	RealmQueuesFound.prototype.String = function() { return this.$val.String(); };
	RealmUpdated.ptr.prototype.Init = function(clientEvent) {
		var $ptr, _entry, _entry$1, _entry$2, _tuple, _tuple$1, _tuple$2, clientEvent, ok, ok$1, ok$2, source, target, x, x$1, x$2, y, y$1, y$2;
		target = this;
		if (!(clientEvent.String() === "realm_updated")) {
			return new UnexpectedEventError.ptr(clientEvent);
		}
		source = clientEvent.Params;
		x = (_entry = source[$String.keyFor("event_id")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, $Float64, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.EventId = (y >> 0);
			}
		}
		x$1 = (_entry$1 = source[$String.keyFor("realm_attrs")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			_tuple$1 = $assertType(x$1, mapType, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.RealmAttrs = NewRealmAttrs(y$1);
			}
		}
		x$2 = (_entry$2 = source[$String.keyFor("realm_id")], _entry$2 !== undefined ? _entry$2.v : $ifaceNil);
		if (!($interfaceIsEqual(x$2, $ifaceNil))) {
			_tuple$2 = $assertType(x$2, $String, true);
			y$2 = _tuple$2[0];
			ok$2 = _tuple$2[1];
			if (ok$2) {
				target.RealmId = y$2;
			}
		}
		return $ifaceNil;
	};
	RealmUpdated.prototype.Init = function(clientEvent) { return this.$val.Init(clientEvent); };
	RealmUpdated.ptr.prototype.Id = function() {
		var $ptr, event;
		event = this;
		return event.EventId;
	};
	RealmUpdated.prototype.Id = function() { return this.$val.Id(); };
	RealmUpdated.ptr.prototype.String = function() {
		var $ptr;
		return "realm_updated";
	};
	RealmUpdated.prototype.String = function() { return this.$val.String(); };
	SearchResults.ptr.prototype.Init = function(clientEvent) {
		var $ptr, _entry, _entry$1, _entry$2, _tuple, _tuple$1, _tuple$2, clientEvent, ok, ok$1, ok$2, source, target, x, x$1, x$2, y, y$1, y$2;
		target = this;
		if (!(clientEvent.String() === "search_results")) {
			return new UnexpectedEventError.ptr(clientEvent);
		}
		source = clientEvent.Params;
		x = (_entry = source[$String.keyFor("channels")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, mapType, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.Channels = MakeChannels(y);
			}
		}
		x$1 = (_entry$1 = source[$String.keyFor("event_id")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			_tuple$1 = $assertType(x$1, $Float64, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.EventId = (y$1 >> 0);
			}
		}
		x$2 = (_entry$2 = source[$String.keyFor("users")], _entry$2 !== undefined ? _entry$2.v : $ifaceNil);
		if (!($interfaceIsEqual(x$2, $ifaceNil))) {
			_tuple$2 = $assertType(x$2, mapType, true);
			y$2 = _tuple$2[0];
			ok$2 = _tuple$2[1];
			if (ok$2) {
				target.Users = MakeUsers(y$2);
			}
		}
		return $ifaceNil;
	};
	SearchResults.prototype.Init = function(clientEvent) { return this.$val.Init(clientEvent); };
	SearchResults.ptr.prototype.Id = function() {
		var $ptr, event;
		event = this;
		return event.EventId;
	};
	SearchResults.prototype.Id = function() { return this.$val.Id(); };
	SearchResults.ptr.prototype.String = function() {
		var $ptr;
		return "search_results";
	};
	SearchResults.prototype.String = function() { return this.$val.String(); };
	SessionCreated.ptr.prototype.Init = function(clientEvent) {
		var $ptr, _entry, _entry$1, _entry$10, _entry$11, _entry$12, _entry$13, _entry$14, _entry$2, _entry$3, _entry$4, _entry$5, _entry$6, _entry$7, _entry$8, _entry$9, _tuple, _tuple$1, _tuple$10, _tuple$11, _tuple$12, _tuple$13, _tuple$14, _tuple$2, _tuple$3, _tuple$4, _tuple$5, _tuple$6, _tuple$7, _tuple$8, _tuple$9, clientEvent, ok, ok$1, ok$10, ok$11, ok$12, ok$13, ok$14, ok$2, ok$3, ok$4, ok$5, ok$6, ok$7, ok$8, ok$9, source, target, x, x$1, x$10, x$11, x$12, x$13, x$14, x$2, x$3, x$4, x$5, x$6, x$7, x$8, x$9, y, y$1, y$10, y$11, y$12, y$13, y$14, y$2, y$24ptr, y$24ptr$1, y$3, y$4, y$5, y$6, y$7, y$8, y$9;
		target = this;
		if (!(clientEvent.String() === "session_created")) {
			return new UnexpectedEventError.ptr(clientEvent);
		}
		source = clientEvent.Params;
		x = (_entry = source[$String.keyFor("event_id")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, $Float64, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.EventId = (y >> 0);
			}
		}
		x$1 = (_entry$1 = source[$String.keyFor("puppet_masters")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			_tuple$1 = $assertType(x$1, mapType, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.PuppetMasters = MakePuppetMasters(y$1);
			}
		}
		x$2 = (_entry$2 = source[$String.keyFor("session_host")], _entry$2 !== undefined ? _entry$2.v : $ifaceNil);
		if (!($interfaceIsEqual(x$2, $ifaceNil))) {
			_tuple$2 = $assertType(x$2, $String, true);
			y$2 = _tuple$2[0];
			ok$2 = _tuple$2[1];
			if (ok$2) {
				target.SessionHost = (y$24ptr || (y$24ptr = new ptrType(function() { return y$2; }, function($v) { y$2 = $v; })));
			}
		}
		x$3 = (_entry$3 = source[$String.keyFor("session_id")], _entry$3 !== undefined ? _entry$3.v : $ifaceNil);
		if (!($interfaceIsEqual(x$3, $ifaceNil))) {
			_tuple$3 = $assertType(x$3, $String, true);
			y$3 = _tuple$3[0];
			ok$3 = _tuple$3[1];
			if (ok$3) {
				target.SessionId = y$3;
			}
		}
		x$4 = (_entry$4 = source[$String.keyFor("user_account")], _entry$4 !== undefined ? _entry$4.v : $ifaceNil);
		if (!($interfaceIsEqual(x$4, $ifaceNil))) {
			_tuple$4 = $assertType(x$4, mapType, true);
			y$4 = _tuple$4[0];
			ok$4 = _tuple$4[1];
			if (ok$4) {
				target.UserAccount = NewUserAccount(y$4);
			}
		}
		x$5 = (_entry$5 = source[$String.keyFor("user_attrs")], _entry$5 !== undefined ? _entry$5.v : $ifaceNil);
		if (!($interfaceIsEqual(x$5, $ifaceNil))) {
			_tuple$5 = $assertType(x$5, mapType, true);
			y$5 = _tuple$5[0];
			ok$5 = _tuple$5[1];
			if (ok$5) {
				target.UserAttrs = NewUserAttrs(y$5);
			}
		}
		x$6 = (_entry$6 = source[$String.keyFor("user_auth")], _entry$6 !== undefined ? _entry$6.v : $ifaceNil);
		if (!($interfaceIsEqual(x$6, $ifaceNil))) {
			_tuple$6 = $assertType(x$6, $String, true);
			y$6 = _tuple$6[0];
			ok$6 = _tuple$6[1];
			if (ok$6) {
				target.UserAuth = (y$24ptr$1 || (y$24ptr$1 = new ptrType(function() { return y$6; }, function($v) { y$6 = $v; })));
			}
		}
		x$7 = (_entry$7 = source[$String.keyFor("user_channels")], _entry$7 !== undefined ? _entry$7.v : $ifaceNil);
		if (!($interfaceIsEqual(x$7, $ifaceNil))) {
			_tuple$7 = $assertType(x$7, mapType, true);
			y$7 = _tuple$7[0];
			ok$7 = _tuple$7[1];
			if (ok$7) {
				target.UserChannels = MakeUserChannels(y$7);
			}
		}
		x$8 = (_entry$8 = source[$String.keyFor("user_dialogues")], _entry$8 !== undefined ? _entry$8.v : $ifaceNil);
		if (!($interfaceIsEqual(x$8, $ifaceNil))) {
			_tuple$8 = $assertType(x$8, mapType, true);
			y$8 = _tuple$8[0];
			ok$8 = _tuple$8[1];
			if (ok$8) {
				target.UserDialogues = MakeUserDialogues(y$8);
			}
		}
		x$9 = (_entry$9 = source[$String.keyFor("user_id")], _entry$9 !== undefined ? _entry$9.v : $ifaceNil);
		if (!($interfaceIsEqual(x$9, $ifaceNil))) {
			_tuple$9 = $assertType(x$9, $String, true);
			y$9 = _tuple$9[0];
			ok$9 = _tuple$9[1];
			if (ok$9) {
				target.UserId = y$9;
			}
		}
		x$10 = (_entry$10 = source[$String.keyFor("user_identities")], _entry$10 !== undefined ? _entry$10.v : $ifaceNil);
		if (!($interfaceIsEqual(x$10, $ifaceNil))) {
			_tuple$10 = $assertType(x$10, mapType, true);
			y$10 = _tuple$10[0];
			ok$10 = _tuple$10[1];
			if (ok$10) {
				target.UserIdentities = MakeUserIdentities(y$10);
			}
		}
		x$11 = (_entry$11 = source[$String.keyFor("user_queues")], _entry$11 !== undefined ? _entry$11.v : $ifaceNil);
		if (!($interfaceIsEqual(x$11, $ifaceNil))) {
			_tuple$11 = $assertType(x$11, mapType, true);
			y$11 = _tuple$11[0];
			ok$11 = _tuple$11[1];
			if (ok$11) {
				target.UserQueues = MakeUserQueues(y$11);
			}
		}
		x$12 = (_entry$12 = source[$String.keyFor("user_realms")], _entry$12 !== undefined ? _entry$12.v : $ifaceNil);
		if (!($interfaceIsEqual(x$12, $ifaceNil))) {
			_tuple$12 = $assertType(x$12, mapType, true);
			y$12 = _tuple$12[0];
			ok$12 = _tuple$12[1];
			if (ok$12) {
				target.UserRealms = MakeUserRealms(y$12);
			}
		}
		x$13 = (_entry$13 = source[$String.keyFor("user_realms_member")], _entry$13 !== undefined ? _entry$13.v : $ifaceNil);
		if (!($interfaceIsEqual(x$13, $ifaceNil))) {
			_tuple$13 = $assertType(x$13, mapType, true);
			y$13 = _tuple$13[0];
			ok$13 = _tuple$13[1];
			if (ok$13) {
				target.UserRealmsMember = MakeUserRealmsMember(y$13);
			}
		}
		x$14 = (_entry$14 = source[$String.keyFor("user_settings")], _entry$14 !== undefined ? _entry$14.v : $ifaceNil);
		if (!($interfaceIsEqual(x$14, $ifaceNil))) {
			_tuple$14 = $assertType(x$14, mapType, true);
			y$14 = _tuple$14[0];
			ok$14 = _tuple$14[1];
			if (ok$14) {
				target.UserSettings = y$14;
			}
		}
		return $ifaceNil;
	};
	SessionCreated.prototype.Init = function(clientEvent) { return this.$val.Init(clientEvent); };
	SessionCreated.ptr.prototype.Id = function() {
		var $ptr, event;
		event = this;
		return event.EventId;
	};
	SessionCreated.prototype.Id = function() { return this.$val.Id(); };
	SessionCreated.ptr.prototype.String = function() {
		var $ptr;
		return "session_created";
	};
	SessionCreated.prototype.String = function() { return this.$val.String(); };
	SessionStatusUpdated.ptr.prototype.Init = function(clientEvent) {
		var $ptr, _entry, _entry$1, _entry$2, _entry$3, _tuple, _tuple$1, _tuple$2, _tuple$3, clientEvent, ok, ok$1, ok$2, ok$3, source, target, x, x$1, x$2, x$3, y, y$1, y$2, y$24ptr, y$24ptr$1, y$3;
		target = this;
		if (!(clientEvent.String() === "session_status_updated")) {
			return new UnexpectedEventError.ptr(clientEvent);
		}
		source = clientEvent.Params;
		x = (_entry = source[$String.keyFor("channel_id")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, $String, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.ChannelId = (y$24ptr || (y$24ptr = new ptrType(function() { return y; }, function($v) { y = $v; })));
			}
		}
		x$1 = (_entry$1 = source[$String.keyFor("event_id")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			_tuple$1 = $assertType(x$1, $Float64, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.EventId = (y$1 >> 0);
			}
		}
		x$2 = (_entry$2 = source[$String.keyFor("message_id")], _entry$2 !== undefined ? _entry$2.v : $ifaceNil);
		if (!($interfaceIsEqual(x$2, $ifaceNil))) {
			_tuple$2 = $assertType(x$2, $String, true);
			y$2 = _tuple$2[0];
			ok$2 = _tuple$2[1];
			if (ok$2) {
				target.MessageId = y$2;
			}
		}
		x$3 = (_entry$3 = source[$String.keyFor("user_id")], _entry$3 !== undefined ? _entry$3.v : $ifaceNil);
		if (!($interfaceIsEqual(x$3, $ifaceNil))) {
			_tuple$3 = $assertType(x$3, $String, true);
			y$3 = _tuple$3[0];
			ok$3 = _tuple$3[1];
			if (ok$3) {
				target.UserId = (y$24ptr$1 || (y$24ptr$1 = new ptrType(function() { return y$3; }, function($v) { y$3 = $v; })));
			}
		}
		return $ifaceNil;
	};
	SessionStatusUpdated.prototype.Init = function(clientEvent) { return this.$val.Init(clientEvent); };
	SessionStatusUpdated.ptr.prototype.Id = function() {
		var $ptr, event;
		event = this;
		return event.EventId;
	};
	SessionStatusUpdated.prototype.Id = function() { return this.$val.Id(); };
	SessionStatusUpdated.ptr.prototype.String = function() {
		var $ptr;
		return "session_status_updated";
	};
	SessionStatusUpdated.prototype.String = function() { return this.$val.String(); };
	TranscriptContents.ptr.prototype.Init = function(clientEvent) {
		var $ptr, _entry, _entry$1, _entry$2, _entry$3, _entry$4, _tuple, _tuple$1, _tuple$2, _tuple$3, _tuple$4, clientEvent, ok, ok$1, ok$2, ok$3, ok$4, source, target, x, x$1, x$2, x$3, x$4, y, y$1, y$2, y$24ptr, y$3, y$4;
		target = this;
		if (!(clientEvent.String() === "transcript_contents")) {
			return new UnexpectedEventError.ptr(clientEvent);
		}
		source = clientEvent.Params;
		x = (_entry = source[$String.keyFor("audience_metadata")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, mapType, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.AudienceMetadata = y;
			}
		}
		x$1 = (_entry$1 = source[$String.keyFor("dialogue_members")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			_tuple$1 = $assertType(x$1, mapType, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.DialogueMembers = MakeDialogueMembers(y$1);
			}
		}
		x$2 = (_entry$2 = source[$String.keyFor("event_id")], _entry$2 !== undefined ? _entry$2.v : $ifaceNil);
		if (!($interfaceIsEqual(x$2, $ifaceNil))) {
			_tuple$2 = $assertType(x$2, $Float64, true);
			y$2 = _tuple$2[0];
			ok$2 = _tuple$2[1];
			if (ok$2) {
				target.EventId = (y$2 >> 0);
			}
		}
		x$3 = (_entry$3 = source[$String.keyFor("message_id")], _entry$3 !== undefined ? _entry$3.v : $ifaceNil);
		if (!($interfaceIsEqual(x$3, $ifaceNil))) {
			_tuple$3 = $assertType(x$3, $String, true);
			y$3 = _tuple$3[0];
			ok$3 = _tuple$3[1];
			if (ok$3) {
				target.MessageId = (y$24ptr || (y$24ptr = new ptrType(function() { return y$3; }, function($v) { y$3 = $v; })));
			}
		}
		x$4 = (_entry$4 = source[$String.keyFor("transcript_messages")], _entry$4 !== undefined ? _entry$4.v : $ifaceNil);
		if (!($interfaceIsEqual(x$4, $ifaceNil))) {
			_tuple$4 = $assertType(x$4, sliceType$4, true);
			y$4 = _tuple$4[0];
			ok$4 = _tuple$4[1];
			if (ok$4) {
				target.TranscriptMessages = AppendTranscriptMessages(sliceType$3.nil, y$4);
			}
		}
		return $ifaceNil;
	};
	TranscriptContents.prototype.Init = function(clientEvent) { return this.$val.Init(clientEvent); };
	TranscriptContents.ptr.prototype.Id = function() {
		var $ptr, event;
		event = this;
		return event.EventId;
	};
	TranscriptContents.prototype.Id = function() { return this.$val.Id(); };
	TranscriptContents.ptr.prototype.String = function() {
		var $ptr;
		return "transcript_contents";
	};
	TranscriptContents.prototype.String = function() { return this.$val.String(); };
	TranscriptDeleted.ptr.prototype.Init = function(clientEvent) {
		var $ptr, _entry, _entry$1, _tuple, _tuple$1, clientEvent, ok, ok$1, source, target, x, x$1, y, y$1;
		target = this;
		if (!(clientEvent.String() === "transcript_deleted")) {
			return new UnexpectedEventError.ptr(clientEvent);
		}
		source = clientEvent.Params;
		x = (_entry = source[$String.keyFor("dialogue_id")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, sliceType$4, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.DialogueId = AppendStrings(sliceType.nil, y);
			}
		}
		x$1 = (_entry$1 = source[$String.keyFor("event_id")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			_tuple$1 = $assertType(x$1, $Float64, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.EventId = (y$1 >> 0);
			}
		}
		return $ifaceNil;
	};
	TranscriptDeleted.prototype.Init = function(clientEvent) { return this.$val.Init(clientEvent); };
	TranscriptDeleted.ptr.prototype.Id = function() {
		var $ptr, event;
		event = this;
		return event.EventId;
	};
	TranscriptDeleted.prototype.Id = function() { return this.$val.Id(); };
	TranscriptDeleted.ptr.prototype.String = function() {
		var $ptr;
		return "transcript_deleted";
	};
	TranscriptDeleted.prototype.String = function() { return this.$val.String(); };
	UserDeleted.ptr.prototype.Init = function(clientEvent) {
		var $ptr, _entry, _entry$1, _tuple, _tuple$1, clientEvent, ok, ok$1, source, target, x, x$1, y, y$1;
		target = this;
		if (!(clientEvent.String() === "user_deleted")) {
			return new UnexpectedEventError.ptr(clientEvent);
		}
		source = clientEvent.Params;
		x = (_entry = source[$String.keyFor("event_id")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, $Float64, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.EventId = (y >> 0);
			}
		}
		x$1 = (_entry$1 = source[$String.keyFor("user_id")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			_tuple$1 = $assertType(x$1, $String, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.UserId = y$1;
			}
		}
		return $ifaceNil;
	};
	UserDeleted.prototype.Init = function(clientEvent) { return this.$val.Init(clientEvent); };
	UserDeleted.ptr.prototype.Id = function() {
		var $ptr, event;
		event = this;
		return event.EventId;
	};
	UserDeleted.prototype.Id = function() { return this.$val.Id(); };
	UserDeleted.ptr.prototype.String = function() {
		var $ptr;
		return "user_deleted";
	};
	UserDeleted.prototype.String = function() { return this.$val.String(); };
	UserFound.ptr.prototype.Init = function(clientEvent) {
		var $ptr, _entry, _entry$1, _entry$10, _entry$11, _entry$12, _entry$13, _entry$14, _entry$2, _entry$3, _entry$4, _entry$5, _entry$6, _entry$7, _entry$8, _entry$9, _tuple, _tuple$1, _tuple$10, _tuple$11, _tuple$12, _tuple$13, _tuple$14, _tuple$2, _tuple$3, _tuple$4, _tuple$5, _tuple$6, _tuple$7, _tuple$8, _tuple$9, clientEvent, ok, ok$1, ok$10, ok$11, ok$12, ok$13, ok$14, ok$2, ok$3, ok$4, ok$5, ok$6, ok$7, ok$8, ok$9, source, target, x, x$1, x$10, x$11, x$12, x$13, x$14, x$2, x$3, x$4, x$5, x$6, x$7, x$8, x$9, y, y$1, y$10, y$11, y$12, y$13, y$14, y$2, y$24ptr, y$3, y$4, y$5, y$6, y$7, y$8, y$9;
		target = this;
		if (!(clientEvent.String() === "user_found")) {
			return new UnexpectedEventError.ptr(clientEvent);
		}
		source = clientEvent.Params;
		x = (_entry = source[$String.keyFor("audience_metadata")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, mapType, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.AudienceMetadata = y;
			}
		}
		x$1 = (_entry$1 = source[$String.keyFor("dialogue_members")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			_tuple$1 = $assertType(x$1, mapType, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.DialogueMembers = MakeDialogueMembers(y$1);
			}
		}
		x$2 = (_entry$2 = source[$String.keyFor("dialogue_status")], _entry$2 !== undefined ? _entry$2.v : $ifaceNil);
		if (!($interfaceIsEqual(x$2, $ifaceNil))) {
			_tuple$2 = $assertType(x$2, $String, true);
			y$2 = _tuple$2[0];
			ok$2 = _tuple$2[1];
			if (ok$2) {
				target.DialogueStatus = (y$24ptr || (y$24ptr = new ptrType(function() { return y$2; }, function($v) { y$2 = $v; })));
			}
		}
		x$3 = (_entry$3 = source[$String.keyFor("event_id")], _entry$3 !== undefined ? _entry$3.v : $ifaceNil);
		if (!($interfaceIsEqual(x$3, $ifaceNil))) {
			_tuple$3 = $assertType(x$3, $Float64, true);
			y$3 = _tuple$3[0];
			ok$3 = _tuple$3[1];
			if (ok$3) {
				target.EventId = (y$3 >> 0);
			}
		}
		x$4 = (_entry$4 = source[$String.keyFor("puppet_masters")], _entry$4 !== undefined ? _entry$4.v : $ifaceNil);
		if (!($interfaceIsEqual(x$4, $ifaceNil))) {
			_tuple$4 = $assertType(x$4, mapType, true);
			y$4 = _tuple$4[0];
			ok$4 = _tuple$4[1];
			if (ok$4) {
				target.PuppetMasters = MakePuppetMasters(y$4);
			}
		}
		x$5 = (_entry$5 = source[$String.keyFor("user_account")], _entry$5 !== undefined ? _entry$5.v : $ifaceNil);
		if (!($interfaceIsEqual(x$5, $ifaceNil))) {
			_tuple$5 = $assertType(x$5, mapType, true);
			y$5 = _tuple$5[0];
			ok$5 = _tuple$5[1];
			if (ok$5) {
				target.UserAccount = NewUserAccount(y$5);
			}
		}
		x$6 = (_entry$6 = source[$String.keyFor("user_attrs")], _entry$6 !== undefined ? _entry$6.v : $ifaceNil);
		if (!($interfaceIsEqual(x$6, $ifaceNil))) {
			_tuple$6 = $assertType(x$6, mapType, true);
			y$6 = _tuple$6[0];
			ok$6 = _tuple$6[1];
			if (ok$6) {
				target.UserAttrs = NewUserAttrs(y$6);
			}
		}
		x$7 = (_entry$7 = source[$String.keyFor("user_channels")], _entry$7 !== undefined ? _entry$7.v : $ifaceNil);
		if (!($interfaceIsEqual(x$7, $ifaceNil))) {
			_tuple$7 = $assertType(x$7, mapType, true);
			y$7 = _tuple$7[0];
			ok$7 = _tuple$7[1];
			if (ok$7) {
				target.UserChannels = MakeUserChannels(y$7);
			}
		}
		x$8 = (_entry$8 = source[$String.keyFor("user_dialogues")], _entry$8 !== undefined ? _entry$8.v : $ifaceNil);
		if (!($interfaceIsEqual(x$8, $ifaceNil))) {
			_tuple$8 = $assertType(x$8, mapType, true);
			y$8 = _tuple$8[0];
			ok$8 = _tuple$8[1];
			if (ok$8) {
				target.UserDialogues = MakeUserDialogues(y$8);
			}
		}
		x$9 = (_entry$9 = source[$String.keyFor("user_id")], _entry$9 !== undefined ? _entry$9.v : $ifaceNil);
		if (!($interfaceIsEqual(x$9, $ifaceNil))) {
			_tuple$9 = $assertType(x$9, $String, true);
			y$9 = _tuple$9[0];
			ok$9 = _tuple$9[1];
			if (ok$9) {
				target.UserId = y$9;
			}
		}
		x$10 = (_entry$10 = source[$String.keyFor("user_identities")], _entry$10 !== undefined ? _entry$10.v : $ifaceNil);
		if (!($interfaceIsEqual(x$10, $ifaceNil))) {
			_tuple$10 = $assertType(x$10, mapType, true);
			y$10 = _tuple$10[0];
			ok$10 = _tuple$10[1];
			if (ok$10) {
				target.UserIdentities = MakeUserIdentities(y$10);
			}
		}
		x$11 = (_entry$11 = source[$String.keyFor("user_queues")], _entry$11 !== undefined ? _entry$11.v : $ifaceNil);
		if (!($interfaceIsEqual(x$11, $ifaceNil))) {
			_tuple$11 = $assertType(x$11, mapType, true);
			y$11 = _tuple$11[0];
			ok$11 = _tuple$11[1];
			if (ok$11) {
				target.UserQueues = MakeUserQueues(y$11);
			}
		}
		x$12 = (_entry$12 = source[$String.keyFor("user_realms")], _entry$12 !== undefined ? _entry$12.v : $ifaceNil);
		if (!($interfaceIsEqual(x$12, $ifaceNil))) {
			_tuple$12 = $assertType(x$12, mapType, true);
			y$12 = _tuple$12[0];
			ok$12 = _tuple$12[1];
			if (ok$12) {
				target.UserRealms = MakeUserRealms(y$12);
			}
		}
		x$13 = (_entry$13 = source[$String.keyFor("user_realms_member")], _entry$13 !== undefined ? _entry$13.v : $ifaceNil);
		if (!($interfaceIsEqual(x$13, $ifaceNil))) {
			_tuple$13 = $assertType(x$13, mapType, true);
			y$13 = _tuple$13[0];
			ok$13 = _tuple$13[1];
			if (ok$13) {
				target.UserRealmsMember = MakeUserRealmsMember(y$13);
			}
		}
		x$14 = (_entry$14 = source[$String.keyFor("user_settings")], _entry$14 !== undefined ? _entry$14.v : $ifaceNil);
		if (!($interfaceIsEqual(x$14, $ifaceNil))) {
			_tuple$14 = $assertType(x$14, mapType, true);
			y$14 = _tuple$14[0];
			ok$14 = _tuple$14[1];
			if (ok$14) {
				target.UserSettings = y$14;
			}
		}
		return $ifaceNil;
	};
	UserFound.prototype.Init = function(clientEvent) { return this.$val.Init(clientEvent); };
	UserFound.ptr.prototype.Id = function() {
		var $ptr, event;
		event = this;
		return event.EventId;
	};
	UserFound.prototype.Id = function() { return this.$val.Id(); };
	UserFound.ptr.prototype.String = function() {
		var $ptr;
		return "user_found";
	};
	UserFound.prototype.String = function() { return this.$val.String(); };
	UserUpdated.ptr.prototype.Init = function(clientEvent) {
		var $ptr, _entry, _entry$1, _entry$2, _entry$3, _entry$4, _entry$5, _tuple, _tuple$1, _tuple$2, _tuple$3, _tuple$4, _tuple$5, clientEvent, ok, ok$1, ok$2, ok$3, ok$4, ok$5, source, target, x, x$1, x$2, x$3, x$4, x$5, y, y$1, y$2, y$3, y$4, y$5;
		target = this;
		if (!(clientEvent.String() === "user_updated")) {
			return new UnexpectedEventError.ptr(clientEvent);
		}
		source = clientEvent.Params;
		x = (_entry = source[$String.keyFor("event_id")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, $Float64, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.EventId = (y >> 0);
			}
		}
		x$1 = (_entry$1 = source[$String.keyFor("puppet_masters")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			_tuple$1 = $assertType(x$1, mapType, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.PuppetMasters = MakePuppetMasters(y$1);
			}
		}
		x$2 = (_entry$2 = source[$String.keyFor("user_account")], _entry$2 !== undefined ? _entry$2.v : $ifaceNil);
		if (!($interfaceIsEqual(x$2, $ifaceNil))) {
			_tuple$2 = $assertType(x$2, mapType, true);
			y$2 = _tuple$2[0];
			ok$2 = _tuple$2[1];
			if (ok$2) {
				target.UserAccount = NewUserAccount(y$2);
			}
		}
		x$3 = (_entry$3 = source[$String.keyFor("user_attrs")], _entry$3 !== undefined ? _entry$3.v : $ifaceNil);
		if (!($interfaceIsEqual(x$3, $ifaceNil))) {
			_tuple$3 = $assertType(x$3, mapType, true);
			y$3 = _tuple$3[0];
			ok$3 = _tuple$3[1];
			if (ok$3) {
				target.UserAttrs = NewUserAttrs(y$3);
			}
		}
		x$4 = (_entry$4 = source[$String.keyFor("user_id")], _entry$4 !== undefined ? _entry$4.v : $ifaceNil);
		if (!($interfaceIsEqual(x$4, $ifaceNil))) {
			_tuple$4 = $assertType(x$4, $String, true);
			y$4 = _tuple$4[0];
			ok$4 = _tuple$4[1];
			if (ok$4) {
				target.UserId = y$4;
			}
		}
		x$5 = (_entry$5 = source[$String.keyFor("user_settings")], _entry$5 !== undefined ? _entry$5.v : $ifaceNil);
		if (!($interfaceIsEqual(x$5, $ifaceNil))) {
			_tuple$5 = $assertType(x$5, mapType, true);
			y$5 = _tuple$5[0];
			ok$5 = _tuple$5[1];
			if (ok$5) {
				target.UserSettings = y$5;
			}
		}
		return $ifaceNil;
	};
	UserUpdated.prototype.Init = function(clientEvent) { return this.$val.Init(clientEvent); };
	UserUpdated.ptr.prototype.Id = function() {
		var $ptr, event;
		event = this;
		return event.EventId;
	};
	UserUpdated.prototype.Id = function() { return this.$val.Id(); };
	UserUpdated.ptr.prototype.String = function() {
		var $ptr;
		return "user_updated";
	};
	UserUpdated.prototype.String = function() { return this.$val.String(); };
	AppendStrings = function(target, source) {
		var $ptr, _i, _ref, _tuple, source, t, target, x, y;
		if (!(source === sliceType$4.nil)) {
			if (target === sliceType.nil || target.$capacity < (target.$length + source.$length >> 0)) {
				t = $makeSlice(sliceType, target.$length, (target.$length + source.$length >> 0));
				$copySlice(t, target);
				target = t;
			}
			_ref = source;
			_i = 0;
			while (true) {
				if (!(_i < _ref.$length)) { break; }
				x = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
				_tuple = $assertType(x, $String, true);
				y = _tuple[0];
				target = $append(target, y);
				_i++;
			}
		}
		return target;
	};
	$pkg.AppendStrings = AppendStrings;
	intPointer = function(x) {
		var $ptr, x, y, y$24ptr;
		y = (x >> 0);
		return (y$24ptr || (y$24ptr = new ptrType$8(function() { return y; }, function($v) { y = $v; })));
	};
	NewChannelMember = function(source) {
		var $ptr, source, target;
		target = ptrType$79.nil;
		target = new ChannelMember.ptr(ptrType$5.nil, ptrType$6.nil, ptrType$3.nil);
		target.Init(source);
		return target;
	};
	$pkg.NewChannelMember = NewChannelMember;
	ChannelMember.ptr.prototype.Init = function(source) {
		var $ptr, _entry, _entry$1, _entry$2, _tuple, _tuple$1, _tuple$2, ok, ok$1, ok$2, source, target, x, x$1, x$2, y, y$1, y$2;
		target = this;
		x = (_entry = source[$String.keyFor("member_attrs")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, mapType, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.MemberAttrs = NewChannelMemberAttrs(y);
			}
		}
		x$1 = (_entry$1 = source[$String.keyFor("puppet_attrs")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			_tuple$1 = $assertType(x$1, mapType, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.PuppetAttrs = NewPuppetAttrs(y$1);
			}
		}
		x$2 = (_entry$2 = source[$String.keyFor("user_attrs")], _entry$2 !== undefined ? _entry$2.v : $ifaceNil);
		if (!($interfaceIsEqual(x$2, $ifaceNil))) {
			_tuple$2 = $assertType(x$2, mapType, true);
			y$2 = _tuple$2[0];
			ok$2 = _tuple$2[1];
			if (ok$2) {
				target.UserAttrs = NewUserAttrs(y$2);
			}
		}
	};
	ChannelMember.prototype.Init = function(source) { return this.$val.Init(source); };
	MakeChannelMembers = function(source) {
		var $ptr, _entry, _i, _key, _keys, _ref, _tuple, key, ok, source, target, x, y;
		target = false;
		target = {};
		_ref = source;
		_i = 0;
		_keys = $keys(_ref);
		while (true) {
			if (!(_i < _keys.length)) { break; }
			_entry = _ref[_keys[_i]];
			if (_entry === undefined) {
				_i++;
				continue;
			}
			key = _entry.k;
			x = _entry.v;
			_tuple = $assertType(x, mapType, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				_key = key; (target || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key)] = { k: _key, v: NewChannelMember(y) };
			}
			_i++;
		}
		return target;
	};
	$pkg.MakeChannelMembers = MakeChannelMembers;
	NewChannelResult = function(source) {
		var $ptr, source, target;
		target = ptrType$80.nil;
		target = new ChannelResult.ptr(ptrType$1.nil, ptrType.nil, 0);
		target.Init(source);
		return target;
	};
	$pkg.NewChannelResult = NewChannelResult;
	ChannelResult.ptr.prototype.Init = function(source) {
		var $ptr, _entry, _entry$1, _entry$2, _tuple, _tuple$1, _tuple$2, ok, ok$1, ok$2, source, target, x, x$1, x$2, y, y$1, y$2, y$24ptr;
		target = this;
		x = (_entry = source[$String.keyFor("channel_attrs")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, mapType, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.ChannelAttrs = NewChannelAttrs(y);
			}
		}
		x$1 = (_entry$1 = source[$String.keyFor("realm_id")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			_tuple$1 = $assertType(x$1, $String, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.RealmId = (y$24ptr || (y$24ptr = new ptrType(function() { return y$1; }, function($v) { y$1 = $v; })));
			}
		}
		x$2 = (_entry$2 = source[$String.keyFor("weight")], _entry$2 !== undefined ? _entry$2.v : $ifaceNil);
		if (!($interfaceIsEqual(x$2, $ifaceNil))) {
			_tuple$2 = $assertType(x$2, $Float64, true);
			y$2 = _tuple$2[0];
			ok$2 = _tuple$2[1];
			if (ok$2) {
				target.Weight = y$2;
			}
		}
	};
	ChannelResult.prototype.Init = function(source) { return this.$val.Init(source); };
	MakeChannels = function(source) {
		var $ptr, _entry, _i, _key, _keys, _ref, _tuple, key, ok, source, target, x, y;
		target = false;
		target = {};
		_ref = source;
		_i = 0;
		_keys = $keys(_ref);
		while (true) {
			if (!(_i < _keys.length)) { break; }
			_entry = _ref[_keys[_i]];
			if (_entry === undefined) {
				_i++;
				continue;
			}
			key = _entry.k;
			x = _entry.v;
			_tuple = $assertType(x, mapType, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				_key = key; (target || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key)] = { k: _key, v: NewChannelResult(y) };
			}
			_i++;
		}
		return target;
	};
	$pkg.MakeChannels = MakeChannels;
	MakeDialogueMembers = function(source) {
		var $ptr, _entry, _i, _key, _keys, _ref, _tuple, key, ok, source, target, x, y;
		target = false;
		target = {};
		_ref = source;
		_i = 0;
		_keys = $keys(_ref);
		while (true) {
			if (!(_i < _keys.length)) { break; }
			_entry = _ref[_keys[_i]];
			if (_entry === undefined) {
				_i++;
				continue;
			}
			key = _entry.k;
			x = _entry.v;
			_tuple = $assertType(x, mapType, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				_key = key; (target || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key)] = { k: _key, v: NewDialogueMemberAttrs(y) };
			}
			_i++;
		}
		return target;
	};
	$pkg.MakeDialogueMembers = MakeDialogueMembers;
	MakeMasterKeys = function(source) {
		var $ptr, _entry, _entry$1, _i, _i$1, _key, _key$1, _keys, _keys$1, _ref, _ref$1, _tuple, _tuple$1, key, key2, ok, ok2, source, t, target, x, x2, y;
		target = false;
		target = {};
		_ref = source;
		_i = 0;
		_keys = $keys(_ref);
		while (true) {
			if (!(_i < _keys.length)) { break; }
			_entry = _ref[_keys[_i]];
			if (_entry === undefined) {
				_i++;
				continue;
			}
			key = _entry.k;
			x = _entry.v;
			_tuple = $assertType(x, mapType, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				t = {};
				_ref$1 = y;
				_i$1 = 0;
				_keys$1 = $keys(_ref$1);
				while (true) {
					if (!(_i$1 < _keys$1.length)) { break; }
					_entry$1 = _ref$1[_keys$1[_i$1]];
					if (_entry$1 === undefined) {
						_i$1++;
						continue;
					}
					key2 = _entry$1.k;
					x2 = _entry$1.v;
					_tuple$1 = $assertType(x2, mapType, true);
					ok2 = _tuple$1[1];
					if (ok2) {
						_key = key2; (t || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key)] = { k: _key, v: new structType.ptr() };
					}
					_i$1++;
				}
				_key$1 = key; (target || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key$1)] = { k: _key$1, v: t };
			}
			_i++;
		}
		return target;
	};
	$pkg.MakeMasterKeys = MakeMasterKeys;
	NewPuppetMaster = function(source) {
		var $ptr, source, target;
		target = ptrType$81.nil;
		target = new PuppetMaster.ptr(ptrType$6.nil);
		target.Init(source);
		return target;
	};
	$pkg.NewPuppetMaster = NewPuppetMaster;
	PuppetMaster.ptr.prototype.Init = function(source) {
		var $ptr, _entry, _tuple, ok, source, target, x, y;
		target = this;
		x = (_entry = source[$String.keyFor("puppet_attrs")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, mapType, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.PuppetAttrs = NewPuppetAttrs(y);
			}
		}
	};
	PuppetMaster.prototype.Init = function(source) { return this.$val.Init(source); };
	MakePuppetMasters = function(source) {
		var $ptr, _entry, _i, _key, _keys, _ref, _tuple, key, ok, source, target, x, y;
		target = false;
		target = {};
		_ref = source;
		_i = 0;
		_keys = $keys(_ref);
		while (true) {
			if (!(_i < _keys.length)) { break; }
			_entry = _ref[_keys[_i]];
			if (_entry === undefined) {
				_i++;
				continue;
			}
			key = _entry.k;
			x = _entry.v;
			_tuple = $assertType(x, mapType, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				_key = key; (target || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key)] = { k: _key, v: NewPuppetMaster(y) };
			}
			_i++;
		}
		return target;
	};
	$pkg.MakePuppetMasters = MakePuppetMasters;
	NewQueueMember = function(source) {
		var $ptr, source, target;
		target = ptrType$82.nil;
		target = new QueueMember.ptr(ptrType$10.nil, ptrType$3.nil);
		target.Init(source);
		return target;
	};
	$pkg.NewQueueMember = NewQueueMember;
	QueueMember.ptr.prototype.Init = function(source) {
		var $ptr, _entry, _entry$1, _tuple, _tuple$1, ok, ok$1, source, target, x, x$1, y, y$1;
		target = this;
		x = (_entry = source[$String.keyFor("member_attrs")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, mapType, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.MemberAttrs = NewQueueMemberAttrs(y);
			}
		}
		x$1 = (_entry$1 = source[$String.keyFor("user_attrs")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			_tuple$1 = $assertType(x$1, mapType, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.UserAttrs = NewUserAttrs(y$1);
			}
		}
	};
	QueueMember.prototype.Init = function(source) { return this.$val.Init(source); };
	MakeQueueMembers = function(source) {
		var $ptr, _entry, _i, _key, _keys, _ref, _tuple, key, ok, source, target, x, y;
		target = false;
		target = {};
		_ref = source;
		_i = 0;
		_keys = $keys(_ref);
		while (true) {
			if (!(_i < _keys.length)) { break; }
			_entry = _ref[_keys[_i]];
			if (_entry === undefined) {
				_i++;
				continue;
			}
			key = _entry.k;
			x = _entry.v;
			_tuple = $assertType(x, mapType, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				_key = key; (target || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key)] = { k: _key, v: NewQueueMember(y) };
			}
			_i++;
		}
		return target;
	};
	$pkg.MakeQueueMembers = MakeQueueMembers;
	NewQueueTranscript = function(source) {
		var $ptr, source, target;
		target = ptrType$11.nil;
		target = new QueueTranscript.ptr(0, "", 0, sliceType.nil, 0, ptrType$8.nil, 0);
		target.Init(source);
		return target;
	};
	$pkg.NewQueueTranscript = NewQueueTranscript;
	QueueTranscript.ptr.prototype.Init = function(source) {
		var $ptr, _entry, _entry$1, _entry$2, _entry$3, _entry$4, _entry$5, _entry$6, _tuple, _tuple$1, _tuple$2, _tuple$3, _tuple$4, _tuple$5, _tuple$6, ok, ok$1, ok$2, ok$3, ok$4, ok$5, ok$6, source, target, x, x$1, x$2, x$3, x$4, x$5, x$6, y, y$1, y$2, y$24ptr, y$3, y$4, y$5, y$6;
		target = this;
		x = (_entry = source[$String.keyFor("accept_time")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, $Float64, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.AcceptTime = y;
			}
		}
		x$1 = (_entry$1 = source[$String.keyFor("agent_id")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			_tuple$1 = $assertType(x$1, $String, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.AgentId = y$1;
			}
		}
		x$2 = (_entry$2 = source[$String.keyFor("complete_time")], _entry$2 !== undefined ? _entry$2.v : $ifaceNil);
		if (!($interfaceIsEqual(x$2, $ifaceNil))) {
			_tuple$2 = $assertType(x$2, $Float64, true);
			y$2 = _tuple$2[0];
			ok$2 = _tuple$2[1];
			if (ok$2) {
				target.CompleteTime = y$2;
			}
		}
		x$3 = (_entry$3 = source[$String.keyFor("dialogue_id")], _entry$3 !== undefined ? _entry$3.v : $ifaceNil);
		if (!($interfaceIsEqual(x$3, $ifaceNil))) {
			_tuple$3 = $assertType(x$3, sliceType$4, true);
			y$3 = _tuple$3[0];
			ok$3 = _tuple$3[1];
			if (ok$3) {
				target.DialogueId = AppendStrings(sliceType.nil, y$3);
			}
		}
		x$4 = (_entry$4 = source[$String.keyFor("finish_time")], _entry$4 !== undefined ? _entry$4.v : $ifaceNil);
		if (!($interfaceIsEqual(x$4, $ifaceNil))) {
			_tuple$4 = $assertType(x$4, $Float64, true);
			y$4 = _tuple$4[0];
			ok$4 = _tuple$4[1];
			if (ok$4) {
				target.FinishTime = y$4;
			}
		}
		x$5 = (_entry$5 = source[$String.keyFor("rating")], _entry$5 !== undefined ? _entry$5.v : $ifaceNil);
		if (!($interfaceIsEqual(x$5, $ifaceNil))) {
			_tuple$5 = $assertType(x$5, $Int, true);
			y$5 = _tuple$5[0];
			ok$5 = _tuple$5[1];
			if (ok$5) {
				target.Rating = (y$24ptr || (y$24ptr = new ptrType$8(function() { return y$5; }, function($v) { y$5 = $v; })));
			}
		}
		x$6 = (_entry$6 = source[$String.keyFor("request_time")], _entry$6 !== undefined ? _entry$6.v : $ifaceNil);
		if (!($interfaceIsEqual(x$6, $ifaceNil))) {
			_tuple$6 = $assertType(x$6, $Float64, true);
			y$6 = _tuple$6[0];
			ok$6 = _tuple$6[1];
			if (ok$6) {
				target.RequestTime = y$6;
			}
		}
	};
	QueueTranscript.prototype.Init = function(source) { return this.$val.Init(source); };
	AppendQueueTranscripts = function(target, source) {
		var $ptr, _i, _ref, _tuple, ok, source, t, target, x, y, z;
		if (!(source === sliceType$4.nil)) {
			if (target === sliceType$2.nil || target.$capacity < (target.$length + source.$length >> 0)) {
				t = $makeSlice(sliceType$2, target.$length, (target.$length + source.$length >> 0));
				$copySlice(t, target);
				target = t;
			}
			_ref = source;
			_i = 0;
			while (true) {
				if (!(_i < _ref.$length)) { break; }
				x = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
				z = ptrType$11.nil;
				_tuple = $assertType(x, mapType, true);
				y = _tuple[0];
				ok = _tuple[1];
				if (ok) {
					z = NewQueueTranscript(y);
				}
				target = $append(target, z);
				_i++;
			}
		}
		return target;
	};
	$pkg.AppendQueueTranscripts = AppendQueueTranscripts;
	NewRealmMember = function(source) {
		var $ptr, source, target;
		target = ptrType$83.nil;
		target = new RealmMember.ptr(ptrType$12.nil, ptrType$6.nil, ptrType$3.nil);
		target.Init(source);
		return target;
	};
	$pkg.NewRealmMember = NewRealmMember;
	RealmMember.ptr.prototype.Init = function(source) {
		var $ptr, _entry, _entry$1, _entry$2, _tuple, _tuple$1, _tuple$2, ok, ok$1, ok$2, source, target, x, x$1, x$2, y, y$1, y$2;
		target = this;
		x = (_entry = source[$String.keyFor("member_attrs")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, mapType, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.MemberAttrs = NewRealmMemberAttrs(y);
			}
		}
		x$1 = (_entry$1 = source[$String.keyFor("puppet_attrs")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			_tuple$1 = $assertType(x$1, mapType, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.PuppetAttrs = NewPuppetAttrs(y$1);
			}
		}
		x$2 = (_entry$2 = source[$String.keyFor("user_attrs")], _entry$2 !== undefined ? _entry$2.v : $ifaceNil);
		if (!($interfaceIsEqual(x$2, $ifaceNil))) {
			_tuple$2 = $assertType(x$2, mapType, true);
			y$2 = _tuple$2[0];
			ok$2 = _tuple$2[1];
			if (ok$2) {
				target.UserAttrs = NewUserAttrs(y$2);
			}
		}
	};
	RealmMember.prototype.Init = function(source) { return this.$val.Init(source); };
	MakeRealmMembers = function(source) {
		var $ptr, _entry, _i, _key, _keys, _ref, _tuple, key, ok, source, target, x, y;
		target = false;
		target = {};
		_ref = source;
		_i = 0;
		_keys = $keys(_ref);
		while (true) {
			if (!(_i < _keys.length)) { break; }
			_entry = _ref[_keys[_i]];
			if (_entry === undefined) {
				_i++;
				continue;
			}
			key = _entry.k;
			x = _entry.v;
			_tuple = $assertType(x, mapType, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				_key = key; (target || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key)] = { k: _key, v: NewRealmMember(y) };
			}
			_i++;
		}
		return target;
	};
	$pkg.MakeRealmMembers = MakeRealmMembers;
	NewRealmQueue = function(source) {
		var $ptr, source, target;
		target = ptrType$84.nil;
		target = new RealmQueue.ptr(ptrType$4.nil, ptrType$8.nil);
		target.Init(source);
		return target;
	};
	$pkg.NewRealmQueue = NewRealmQueue;
	RealmQueue.ptr.prototype.Init = function(source) {
		var $ptr, _entry, _entry$1, _tuple, _tuple$1, ok, ok$1, source, target, x, x$1, y, y$1, y$24ptr;
		target = this;
		x = (_entry = source[$String.keyFor("queue_attrs")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, mapType, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.QueueAttrs = NewQueueAttrs(y);
			}
		}
		x$1 = (_entry$1 = source[$String.keyFor("queue_position")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			_tuple$1 = $assertType(x$1, $Int, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.QueuePosition = (y$24ptr || (y$24ptr = new ptrType$8(function() { return y$1; }, function($v) { y$1 = $v; })));
			}
		}
	};
	RealmQueue.prototype.Init = function(source) { return this.$val.Init(source); };
	MakeRealmQueues = function(source) {
		var $ptr, _entry, _i, _key, _keys, _ref, _tuple, key, ok, source, target, x, y;
		target = false;
		target = {};
		_ref = source;
		_i = 0;
		_keys = $keys(_ref);
		while (true) {
			if (!(_i < _keys.length)) { break; }
			_entry = _ref[_keys[_i]];
			if (_entry === undefined) {
				_i++;
				continue;
			}
			key = _entry.k;
			x = _entry.v;
			_tuple = $assertType(x, mapType, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				_key = key; (target || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key)] = { k: _key, v: NewRealmQueue(y) };
			}
			_i++;
		}
		return target;
	};
	$pkg.MakeRealmQueues = MakeRealmQueues;
	NewTranscriptMessage = function(source) {
		var $ptr, source, target;
		target = ptrType$14.nil;
		target = new TranscriptMessage.ptr(false, "", 0, "", ptrType.nil, ptrType.nil, $ifaceNil);
		target.Init(source);
		return target;
	};
	$pkg.NewTranscriptMessage = NewTranscriptMessage;
	TranscriptMessage.ptr.prototype.Init = function(source) {
		var $ptr, _entry, _entry$1, _entry$2, _entry$3, _entry$4, _entry$5, _entry$6, _tuple, _tuple$1, _tuple$2, _tuple$3, _tuple$4, _tuple$5, ok, ok$1, ok$2, ok$3, ok$4, ok$5, source, target, x, x$1, x$2, x$3, x$4, x$5, x$6, y, y$1, y$2, y$24ptr, y$24ptr$1, y$3, y$4, y$5;
		target = this;
		x = (_entry = source[$String.keyFor("message_fold")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			target.MessageFold = true;
		}
		x$1 = (_entry$1 = source[$String.keyFor("message_id")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			_tuple = $assertType(x$1, $String, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.MessageId = y;
			}
		}
		x$2 = (_entry$2 = source[$String.keyFor("message_time")], _entry$2 !== undefined ? _entry$2.v : $ifaceNil);
		if (!($interfaceIsEqual(x$2, $ifaceNil))) {
			_tuple$1 = $assertType(x$2, $Float64, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.MessageTime = y$1;
			}
		}
		x$3 = (_entry$3 = source[$String.keyFor("message_type")], _entry$3 !== undefined ? _entry$3.v : $ifaceNil);
		if (!($interfaceIsEqual(x$3, $ifaceNil))) {
			_tuple$2 = $assertType(x$3, $String, true);
			y$2 = _tuple$2[0];
			ok$2 = _tuple$2[1];
			if (ok$2) {
				target.MessageType = y$2;
			}
		}
		x$4 = (_entry$4 = source[$String.keyFor("message_user_id")], _entry$4 !== undefined ? _entry$4.v : $ifaceNil);
		if (!($interfaceIsEqual(x$4, $ifaceNil))) {
			_tuple$3 = $assertType(x$4, $String, true);
			y$3 = _tuple$3[0];
			ok$3 = _tuple$3[1];
			if (ok$3) {
				target.MessageUserId = (y$24ptr || (y$24ptr = new ptrType(function() { return y$3; }, function($v) { y$3 = $v; })));
			}
		}
		x$5 = (_entry$5 = source[$String.keyFor("message_user_name")], _entry$5 !== undefined ? _entry$5.v : $ifaceNil);
		if (!($interfaceIsEqual(x$5, $ifaceNil))) {
			_tuple$4 = $assertType(x$5, $String, true);
			y$4 = _tuple$4[0];
			ok$4 = _tuple$4[1];
			if (ok$4) {
				target.MessageUserName = (y$24ptr$1 || (y$24ptr$1 = new ptrType(function() { return y$4; }, function($v) { y$4 = $v; })));
			}
		}
		x$6 = (_entry$6 = source[$String.keyFor("payload")], _entry$6 !== undefined ? _entry$6.v : $ifaceNil);
		if (!($interfaceIsEqual(x$6, $ifaceNil))) {
			_tuple$5 = $assertType(x$6, $emptyInterface, true);
			y$5 = _tuple$5[0];
			ok$5 = _tuple$5[1];
			if (ok$5) {
				target.Payload = y$5;
			}
		}
	};
	TranscriptMessage.prototype.Init = function(source) { return this.$val.Init(source); };
	AppendTranscriptMessages = function(target, source) {
		var $ptr, _i, _ref, _tuple, ok, source, t, target, x, y, z;
		if (!(source === sliceType$4.nil)) {
			if (target === sliceType$3.nil || target.$capacity < (target.$length + source.$length >> 0)) {
				t = $makeSlice(sliceType$3, target.$length, (target.$length + source.$length >> 0));
				$copySlice(t, target);
				target = t;
			}
			_ref = source;
			_i = 0;
			while (true) {
				if (!(_i < _ref.$length)) { break; }
				x = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
				z = ptrType$14.nil;
				_tuple = $assertType(x, mapType, true);
				y = _tuple[0];
				ok = _tuple[1];
				if (ok) {
					z = NewTranscriptMessage(y);
				}
				target = $append(target, z);
				_i++;
			}
		}
		return target;
	};
	$pkg.AppendTranscriptMessages = AppendTranscriptMessages;
	NewUserAccount = function(source) {
		var $ptr, source, target;
		target = ptrType$13.nil;
		target = new UserAccount.ptr(ptrType$68.nil, ptrType$69.nil, ptrType$68.nil, ptrType$68.nil, sliceType$5.nil, ptrType$86.nil);
		target.Init(source);
		return target;
	};
	$pkg.NewUserAccount = NewUserAccount;
	UserAccount.ptr.prototype.Init = function(source) {
		var $ptr, _entry, _entry$1, _entry$2, _entry$3, _entry$4, _entry$5, _tuple, _tuple$1, _tuple$2, _tuple$3, _tuple$4, _tuple$5, ok, ok$1, ok$2, ok$3, ok$4, ok$5, source, target, x, x$1, x$2, x$3, x$4, x$5, y, y$1, y$2, y$3, y$4, y$5;
		target = this;
		x = (_entry = source[$String.keyFor("channels")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, mapType, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.Channels = NewUserAccountObjects(y);
			}
		}
		x$1 = (_entry$1 = source[$String.keyFor("queue_members")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			_tuple$1 = $assertType(x$1, mapType, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.QueueMembers = NewUserAccountMembers(y$1);
			}
		}
		x$2 = (_entry$2 = source[$String.keyFor("queues")], _entry$2 !== undefined ? _entry$2.v : $ifaceNil);
		if (!($interfaceIsEqual(x$2, $ifaceNil))) {
			_tuple$2 = $assertType(x$2, mapType, true);
			y$2 = _tuple$2[0];
			ok$2 = _tuple$2[1];
			if (ok$2) {
				target.Queues = NewUserAccountObjects(y$2);
			}
		}
		x$3 = (_entry$3 = source[$String.keyFor("realms")], _entry$3 !== undefined ? _entry$3.v : $ifaceNil);
		if (!($interfaceIsEqual(x$3, $ifaceNil))) {
			_tuple$3 = $assertType(x$3, mapType, true);
			y$3 = _tuple$3[0];
			ok$3 = _tuple$3[1];
			if (ok$3) {
				target.Realms = NewUserAccountObjects(y$3);
			}
		}
		x$4 = (_entry$4 = source[$String.keyFor("subscriptions")], _entry$4 !== undefined ? _entry$4.v : $ifaceNil);
		if (!($interfaceIsEqual(x$4, $ifaceNil))) {
			_tuple$4 = $assertType(x$4, sliceType$4, true);
			y$4 = _tuple$4[0];
			ok$4 = _tuple$4[1];
			if (ok$4) {
				target.Subscriptions = AppendUserAccountSubscriptions(sliceType$5.nil, y$4);
			}
		}
		x$5 = (_entry$5 = source[$String.keyFor("uploads")], _entry$5 !== undefined ? _entry$5.v : $ifaceNil);
		if (!($interfaceIsEqual(x$5, $ifaceNil))) {
			_tuple$5 = $assertType(x$5, mapType, true);
			y$5 = _tuple$5[0];
			ok$5 = _tuple$5[1];
			if (ok$5) {
				target.Uploads = NewUserAccountExtent(y$5);
			}
		}
	};
	UserAccount.prototype.Init = function(source) { return this.$val.Init(source); };
	NewUserAccountExtent = function(source) {
		var $ptr, source, target;
		target = ptrType$86.nil;
		target = new UserAccountExtent.ptr(0, 0);
		target.Init(source);
		return target;
	};
	$pkg.NewUserAccountExtent = NewUserAccountExtent;
	UserAccountExtent.ptr.prototype.Init = function(source) {
		var $ptr, _entry, _entry$1, _tuple, _tuple$1, ok, ok$1, source, target, x, x$1, y, y$1;
		target = this;
		x = (_entry = source[$String.keyFor("available")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, $Float64, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.Available = y;
			}
		}
		x$1 = (_entry$1 = source[$String.keyFor("quota")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			_tuple$1 = $assertType(x$1, $Float64, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.Quota = y$1;
			}
		}
	};
	UserAccountExtent.prototype.Init = function(source) { return this.$val.Init(source); };
	NewUserAccountMembers = function(source) {
		var $ptr, source, target;
		target = ptrType$69.nil;
		target = new UserAccountMembers.ptr(0);
		target.Init(source);
		return target;
	};
	$pkg.NewUserAccountMembers = NewUserAccountMembers;
	UserAccountMembers.ptr.prototype.Init = function(source) {
		var $ptr, _entry, _tuple, ok, source, target, x, y;
		target = this;
		x = (_entry = source[$String.keyFor("quota")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, $Int, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.Quota = y;
			}
		}
	};
	UserAccountMembers.prototype.Init = function(source) { return this.$val.Init(source); };
	NewUserAccountObjects = function(source) {
		var $ptr, source, target;
		target = ptrType$68.nil;
		target = new UserAccountObjects.ptr(0, 0);
		target.Init(source);
		return target;
	};
	$pkg.NewUserAccountObjects = NewUserAccountObjects;
	UserAccountObjects.ptr.prototype.Init = function(source) {
		var $ptr, _entry, _entry$1, _tuple, _tuple$1, ok, ok$1, source, target, x, x$1, y, y$1;
		target = this;
		x = (_entry = source[$String.keyFor("available")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, $Int, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.Available = y;
			}
		}
		x$1 = (_entry$1 = source[$String.keyFor("quota")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			_tuple$1 = $assertType(x$1, $Int, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.Quota = y$1;
			}
		}
	};
	UserAccountObjects.prototype.Init = function(source) { return this.$val.Init(source); };
	NewUserAccountSubscription = function(source) {
		var $ptr, source, target;
		target = ptrType$85.nil;
		target = new UserAccountSubscription.ptr(false, ptrType$68.nil, ptrType$8.nil, "", ptrType$69.nil, ptrType$68.nil, ptrType$68.nil, ptrType$8.nil);
		target.Init(source);
		return target;
	};
	$pkg.NewUserAccountSubscription = NewUserAccountSubscription;
	UserAccountSubscription.ptr.prototype.Init = function(source) {
		var $ptr, _entry, _entry$1, _entry$2, _entry$3, _entry$4, _entry$5, _entry$6, _entry$7, _tuple, _tuple$1, _tuple$2, _tuple$3, _tuple$4, _tuple$5, _tuple$6, ok, ok$1, ok$2, ok$3, ok$4, ok$5, ok$6, source, target, x, x$1, x$2, x$3, x$4, x$5, x$6, x$7, y, y$1, y$2, y$24ptr, y$24ptr$1, y$3, y$4, y$5, y$6;
		target = this;
		x = (_entry = source[$String.keyFor("active")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			target.Active = true;
		}
		x$1 = (_entry$1 = source[$String.keyFor("channels")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			_tuple = $assertType(x$1, mapType, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.Channels = NewUserAccountObjects(y);
			}
		}
		x$2 = (_entry$2 = source[$String.keyFor("expiration")], _entry$2 !== undefined ? _entry$2.v : $ifaceNil);
		if (!($interfaceIsEqual(x$2, $ifaceNil))) {
			_tuple$1 = $assertType(x$2, $Int, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.Expiration = (y$24ptr || (y$24ptr = new ptrType$8(function() { return y$1; }, function($v) { y$1 = $v; })));
			}
		}
		x$3 = (_entry$3 = source[$String.keyFor("plan")], _entry$3 !== undefined ? _entry$3.v : $ifaceNil);
		if (!($interfaceIsEqual(x$3, $ifaceNil))) {
			_tuple$2 = $assertType(x$3, $String, true);
			y$2 = _tuple$2[0];
			ok$2 = _tuple$2[1];
			if (ok$2) {
				target.Plan = y$2;
			}
		}
		x$4 = (_entry$4 = source[$String.keyFor("queue_members")], _entry$4 !== undefined ? _entry$4.v : $ifaceNil);
		if (!($interfaceIsEqual(x$4, $ifaceNil))) {
			_tuple$3 = $assertType(x$4, mapType, true);
			y$3 = _tuple$3[0];
			ok$3 = _tuple$3[1];
			if (ok$3) {
				target.QueueMembers = NewUserAccountMembers(y$3);
			}
		}
		x$5 = (_entry$5 = source[$String.keyFor("queues")], _entry$5 !== undefined ? _entry$5.v : $ifaceNil);
		if (!($interfaceIsEqual(x$5, $ifaceNil))) {
			_tuple$4 = $assertType(x$5, mapType, true);
			y$4 = _tuple$4[0];
			ok$4 = _tuple$4[1];
			if (ok$4) {
				target.Queues = NewUserAccountObjects(y$4);
			}
		}
		x$6 = (_entry$6 = source[$String.keyFor("realms")], _entry$6 !== undefined ? _entry$6.v : $ifaceNil);
		if (!($interfaceIsEqual(x$6, $ifaceNil))) {
			_tuple$5 = $assertType(x$6, mapType, true);
			y$5 = _tuple$5[0];
			ok$5 = _tuple$5[1];
			if (ok$5) {
				target.Realms = NewUserAccountObjects(y$5);
			}
		}
		x$7 = (_entry$7 = source[$String.keyFor("renewal")], _entry$7 !== undefined ? _entry$7.v : $ifaceNil);
		if (!($interfaceIsEqual(x$7, $ifaceNil))) {
			_tuple$6 = $assertType(x$7, $Int, true);
			y$6 = _tuple$6[0];
			ok$6 = _tuple$6[1];
			if (ok$6) {
				target.Renewal = (y$24ptr$1 || (y$24ptr$1 = new ptrType$8(function() { return y$6; }, function($v) { y$6 = $v; })));
			}
		}
	};
	UserAccountSubscription.prototype.Init = function(source) { return this.$val.Init(source); };
	AppendUserAccountSubscriptions = function(target, source) {
		var $ptr, _i, _ref, _tuple, ok, source, t, target, x, y, z;
		if (!(source === sliceType$4.nil)) {
			if (target === sliceType$5.nil || target.$capacity < (target.$length + source.$length >> 0)) {
				t = $makeSlice(sliceType$5, target.$length, (target.$length + source.$length >> 0));
				$copySlice(t, target);
				target = t;
			}
			_ref = source;
			_i = 0;
			while (true) {
				if (!(_i < _ref.$length)) { break; }
				x = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
				z = ptrType$85.nil;
				_tuple = $assertType(x, mapType, true);
				y = _tuple[0];
				ok = _tuple[1];
				if (ok) {
					z = NewUserAccountSubscription(y);
				}
				target = $append(target, z);
				_i++;
			}
		}
		return target;
	};
	$pkg.AppendUserAccountSubscriptions = AppendUserAccountSubscriptions;
	NewUserChannel = function(source) {
		var $ptr, source, target;
		target = ptrType$87.nil;
		target = new UserChannel.ptr(ptrType$1.nil, ptrType.nil, ptrType.nil);
		target.Init(source);
		return target;
	};
	$pkg.NewUserChannel = NewUserChannel;
	UserChannel.ptr.prototype.Init = function(source) {
		var $ptr, _entry, _entry$1, _entry$2, _tuple, _tuple$1, _tuple$2, ok, ok$1, ok$2, source, target, x, x$1, x$2, y, y$1, y$2, y$24ptr, y$24ptr$1;
		target = this;
		x = (_entry = source[$String.keyFor("channel_attrs")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, mapType, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.ChannelAttrs = NewChannelAttrs(y);
			}
		}
		x$1 = (_entry$1 = source[$String.keyFor("channel_status")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			_tuple$1 = $assertType(x$1, $String, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.ChannelStatus = (y$24ptr || (y$24ptr = new ptrType(function() { return y$1; }, function($v) { y$1 = $v; })));
			}
		}
		x$2 = (_entry$2 = source[$String.keyFor("realm_id")], _entry$2 !== undefined ? _entry$2.v : $ifaceNil);
		if (!($interfaceIsEqual(x$2, $ifaceNil))) {
			_tuple$2 = $assertType(x$2, $String, true);
			y$2 = _tuple$2[0];
			ok$2 = _tuple$2[1];
			if (ok$2) {
				target.RealmId = (y$24ptr$1 || (y$24ptr$1 = new ptrType(function() { return y$2; }, function($v) { y$2 = $v; })));
			}
		}
	};
	UserChannel.prototype.Init = function(source) { return this.$val.Init(source); };
	MakeUserChannels = function(source) {
		var $ptr, _entry, _i, _key, _keys, _ref, _tuple, key, ok, source, target, x, y;
		target = false;
		target = {};
		_ref = source;
		_i = 0;
		_keys = $keys(_ref);
		while (true) {
			if (!(_i < _keys.length)) { break; }
			_entry = _ref[_keys[_i]];
			if (_entry === undefined) {
				_i++;
				continue;
			}
			key = _entry.k;
			x = _entry.v;
			_tuple = $assertType(x, mapType, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				_key = key; (target || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key)] = { k: _key, v: NewUserChannel(y) };
			}
			_i++;
		}
		return target;
	};
	$pkg.MakeUserChannels = MakeUserChannels;
	NewUserDialogue = function(source) {
		var $ptr, source, target;
		target = ptrType$88.nil;
		target = new UserDialogue.ptr(false, false, ptrType.nil);
		target.Init(source);
		return target;
	};
	$pkg.NewUserDialogue = NewUserDialogue;
	UserDialogue.ptr.prototype.Init = function(source) {
		var $ptr, _entry, _entry$1, _entry$2, _tuple, _tuple$1, _tuple$2, ok, ok$1, ok$2, source, target, x, x$1, x$2, y, y$1, y$2, y$24ptr;
		target = this;
		x = (_entry = source[$String.keyFor("audience_metadata")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, mapType, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.AudienceMetadata = y;
			}
		}
		x$1 = (_entry$1 = source[$String.keyFor("dialogue_members")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			_tuple$1 = $assertType(x$1, mapType, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.DialogueMembers = MakeDialogueMembers(y$1);
			}
		}
		x$2 = (_entry$2 = source[$String.keyFor("dialogue_status")], _entry$2 !== undefined ? _entry$2.v : $ifaceNil);
		if (!($interfaceIsEqual(x$2, $ifaceNil))) {
			_tuple$2 = $assertType(x$2, $String, true);
			y$2 = _tuple$2[0];
			ok$2 = _tuple$2[1];
			if (ok$2) {
				target.DialogueStatus = (y$24ptr || (y$24ptr = new ptrType(function() { return y$2; }, function($v) { y$2 = $v; })));
			}
		}
	};
	UserDialogue.prototype.Init = function(source) { return this.$val.Init(source); };
	MakeUserDialogues = function(source) {
		var $ptr, _entry, _i, _key, _keys, _ref, _tuple, key, ok, source, target, x, y;
		target = false;
		target = {};
		_ref = source;
		_i = 0;
		_keys = $keys(_ref);
		while (true) {
			if (!(_i < _keys.length)) { break; }
			_entry = _ref[_keys[_i]];
			if (_entry === undefined) {
				_i++;
				continue;
			}
			key = _entry.k;
			x = _entry.v;
			_tuple = $assertType(x, mapType, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				_key = key; (target || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key)] = { k: _key, v: NewUserDialogue(y) };
			}
			_i++;
		}
		return target;
	};
	$pkg.MakeUserDialogues = MakeUserDialogues;
	MakeUserIdentities = function(source) {
		var $ptr, _entry, _entry$1, _i, _i$1, _key, _key$1, _keys, _keys$1, _ref, _ref$1, _tuple, _tuple$1, key, key2, ok, ok2, source, t, target, x, x2, y, y2;
		target = false;
		target = {};
		_ref = source;
		_i = 0;
		_keys = $keys(_ref);
		while (true) {
			if (!(_i < _keys.length)) { break; }
			_entry = _ref[_keys[_i]];
			if (_entry === undefined) {
				_i++;
				continue;
			}
			key = _entry.k;
			x = _entry.v;
			_tuple = $assertType(x, mapType, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				t = {};
				_ref$1 = y;
				_i$1 = 0;
				_keys$1 = $keys(_ref$1);
				while (true) {
					if (!(_i$1 < _keys$1.length)) { break; }
					_entry$1 = _ref$1[_keys$1[_i$1]];
					if (_entry$1 === undefined) {
						_i$1++;
						continue;
					}
					key2 = _entry$1.k;
					x2 = _entry$1.v;
					_tuple$1 = $assertType(x2, mapType, true);
					y2 = _tuple$1[0];
					ok2 = _tuple$1[1];
					if (ok2) {
						_key = key2; (t || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key)] = { k: _key, v: NewIdentityAttrs(y2) };
					}
					_i$1++;
				}
				_key$1 = key; (target || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key$1)] = { k: _key$1, v: t };
			}
			_i++;
		}
		return target;
	};
	$pkg.MakeUserIdentities = MakeUserIdentities;
	NewUserQueue = function(source) {
		var $ptr, source, target;
		target = ptrType$89.nil;
		target = new UserQueue.ptr(ptrType$4.nil, "");
		target.Init(source);
		return target;
	};
	$pkg.NewUserQueue = NewUserQueue;
	UserQueue.ptr.prototype.Init = function(source) {
		var $ptr, _entry, _entry$1, _tuple, _tuple$1, ok, ok$1, source, target, x, x$1, y, y$1;
		target = this;
		x = (_entry = source[$String.keyFor("queue_attrs")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, mapType, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.QueueAttrs = NewQueueAttrs(y);
			}
		}
		x$1 = (_entry$1 = source[$String.keyFor("realm_id")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			_tuple$1 = $assertType(x$1, $String, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.RealmId = y$1;
			}
		}
	};
	UserQueue.prototype.Init = function(source) { return this.$val.Init(source); };
	MakeUserQueues = function(source) {
		var $ptr, _entry, _i, _key, _keys, _ref, _tuple, key, ok, source, target, x, y;
		target = false;
		target = {};
		_ref = source;
		_i = 0;
		_keys = $keys(_ref);
		while (true) {
			if (!(_i < _keys.length)) { break; }
			_entry = _ref[_keys[_i]];
			if (_entry === undefined) {
				_i++;
				continue;
			}
			key = _entry.k;
			x = _entry.v;
			_tuple = $assertType(x, mapType, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				_key = key; (target || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key)] = { k: _key, v: NewUserQueue(y) };
			}
			_i++;
		}
		return target;
	};
	$pkg.MakeUserQueues = MakeUserQueues;
	MakeUserRealms = function(source) {
		var $ptr, _entry, _i, _key, _keys, _ref, _tuple, key, ok, source, target, x, y;
		target = false;
		target = {};
		_ref = source;
		_i = 0;
		_keys = $keys(_ref);
		while (true) {
			if (!(_i < _keys.length)) { break; }
			_entry = _ref[_keys[_i]];
			if (_entry === undefined) {
				_i++;
				continue;
			}
			key = _entry.k;
			x = _entry.v;
			_tuple = $assertType(x, mapType, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				_key = key; (target || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key)] = { k: _key, v: NewRealmAttrs(y) };
			}
			_i++;
		}
		return target;
	};
	$pkg.MakeUserRealms = MakeUserRealms;
	MakeUserRealmsMember = function(source) {
		var $ptr, _entry, _i, _key, _keys, _ref, _tuple, key, ok, source, target, x, y;
		target = false;
		target = {};
		_ref = source;
		_i = 0;
		_keys = $keys(_ref);
		while (true) {
			if (!(_i < _keys.length)) { break; }
			_entry = _ref[_keys[_i]];
			if (_entry === undefined) {
				_i++;
				continue;
			}
			key = _entry.k;
			x = _entry.v;
			_tuple = $assertType(x, mapType, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				_key = key; (target || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key)] = { k: _key, v: NewRealmMemberAttrs(y) };
			}
			_i++;
		}
		return target;
	};
	$pkg.MakeUserRealmsMember = MakeUserRealmsMember;
	NewUserResult = function(source) {
		var $ptr, source, target;
		target = ptrType$90.nil;
		target = new UserResult.ptr(ptrType$3.nil, 0);
		target.Init(source);
		return target;
	};
	$pkg.NewUserResult = NewUserResult;
	UserResult.ptr.prototype.Init = function(source) {
		var $ptr, _entry, _entry$1, _tuple, _tuple$1, ok, ok$1, source, target, x, x$1, y, y$1;
		target = this;
		x = (_entry = source[$String.keyFor("user_attrs")], _entry !== undefined ? _entry.v : $ifaceNil);
		if (!($interfaceIsEqual(x, $ifaceNil))) {
			_tuple = $assertType(x, mapType, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				target.UserAttrs = NewUserAttrs(y);
			}
		}
		x$1 = (_entry$1 = source[$String.keyFor("weight")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil);
		if (!($interfaceIsEqual(x$1, $ifaceNil))) {
			_tuple$1 = $assertType(x$1, $Float64, true);
			y$1 = _tuple$1[0];
			ok$1 = _tuple$1[1];
			if (ok$1) {
				target.Weight = y$1;
			}
		}
	};
	UserResult.prototype.Init = function(source) { return this.$val.Init(source); };
	MakeUsers = function(source) {
		var $ptr, _entry, _i, _key, _keys, _ref, _tuple, key, ok, source, target, x, y;
		target = false;
		target = {};
		_ref = source;
		_i = 0;
		_keys = $keys(_ref);
		while (true) {
			if (!(_i < _keys.length)) { break; }
			_entry = _ref[_keys[_i]];
			if (_entry === undefined) {
				_i++;
				continue;
			}
			key = _entry.k;
			x = _entry.v;
			_tuple = $assertType(x, mapType, true);
			y = _tuple[0];
			ok = _tuple[1];
			if (ok) {
				_key = key; (target || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key)] = { k: _key, v: NewUserResult(y) };
			}
			_i++;
		}
		return target;
	};
	$pkg.MakeUsers = MakeUsers;
	ptrType$115.methods = [{prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}, {prop: "newClientAction", name: "newClientAction", pkg: "github.com/ninchat/ninchat-go/ninchatapi", typ: $funcType([], [ptrType$17, $error], false)}, {prop: "Invoke", name: "Invoke", pkg: "", typ: $funcType([ptrType$16], [ptrType$44, $error], false)}];
	ptrType$116.methods = [{prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}, {prop: "newClientAction", name: "newClientAction", pkg: "github.com/ninchat/ninchat-go/ninchatapi", typ: $funcType([], [ptrType$17, $error], false)}, {prop: "Invoke", name: "Invoke", pkg: "", typ: $funcType([ptrType$16], [ptrType$45, $error], false)}];
	ptrType$120.methods = [{prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}, {prop: "newClientAction", name: "newClientAction", pkg: "github.com/ninchat/ninchat-go/ninchatapi", typ: $funcType([], [ptrType$17, $error], false)}, {prop: "Invoke", name: "Invoke", pkg: "", typ: $funcType([ptrType$16], [ptrType$47, $error], false)}];
	ptrType$133.methods = [{prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}, {prop: "newClientAction", name: "newClientAction", pkg: "github.com/ninchat/ninchat-go/ninchatapi", typ: $funcType([], [ptrType$17, $error], false)}, {prop: "Invoke", name: "Invoke", pkg: "", typ: $funcType([ptrType$16], [ptrType$18, $error], false)}];
	ptrType$1.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([mapType], [], false)}];
	ptrType$5.methods = [{prop: "memberAttrs", name: "memberAttrs", pkg: "github.com/ninchat/ninchat-go/ninchatapi", typ: $funcType([], [], false)}, {prop: "Init", name: "Init", pkg: "", typ: $funcType([mapType], [], false)}];
	ptrType$58.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([mapType], [], false)}];
	ptrType$7.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([mapType], [], false)}];
	ptrType$6.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([mapType], [], false)}];
	ptrType$4.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([mapType], [], false)}];
	ptrType$10.methods = [{prop: "memberAttrs", name: "memberAttrs", pkg: "github.com/ninchat/ninchat-go/ninchatapi", typ: $funcType([], [], false)}, {prop: "Init", name: "Init", pkg: "", typ: $funcType([mapType], [], false)}];
	ptrType$2.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([mapType], [], false)}];
	ptrType$12.methods = [{prop: "memberAttrs", name: "memberAttrs", pkg: "github.com/ninchat/ninchat-go/ninchatapi", typ: $funcType([], [], false)}, {prop: "Init", name: "Init", pkg: "", typ: $funcType([mapType], [], false)}];
	ptrType$3.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([mapType], [], false)}];
	ptrType$144.methods = [{prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$23.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([ptrType$15], [$error], false)}, {prop: "Id", name: "Id", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$36.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([ptrType$15], [$error], false)}, {prop: "Id", name: "Id", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$54.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([ptrType$15], [$error], false)}, {prop: "Id", name: "Id", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$71.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([ptrType$15], [$error], false)}, {prop: "Id", name: "Id", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$37.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([ptrType$15], [$error], false)}, {prop: "Id", name: "Id", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$24.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([ptrType$15], [$error], false)}, {prop: "Id", name: "Id", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$20.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([ptrType$15], [$error], false)}, {prop: "Id", name: "Id", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$51.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([ptrType$15], [$error], false)}, {prop: "Id", name: "Id", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$60.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([ptrType$15], [$error], false)}, {prop: "Id", name: "Id", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$48.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([ptrType$15], [$error], false)}, {prop: "Id", name: "Id", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$57.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([ptrType$15], [$error], false)}, {prop: "Id", name: "Id", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$18.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([ptrType$15], [$error], false)}, {prop: "Id", name: "Id", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$72.methods = [{prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Init", name: "Init", pkg: "", typ: $funcType([ptrType$15], [$error], false)}, {prop: "Id", name: "Id", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$45.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([ptrType$15], [$error], false)}, {prop: "Id", name: "Id", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$47.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([ptrType$15], [$error], false)}, {prop: "Id", name: "Id", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$25.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([ptrType$15], [$error], false)}, {prop: "Id", name: "Id", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$29.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([ptrType$15], [$error], false)}, {prop: "Id", name: "Id", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$38.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([ptrType$15], [$error], false)}, {prop: "Id", name: "Id", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$55.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([ptrType$15], [$error], false)}, {prop: "Id", name: "Id", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$26.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([ptrType$15], [$error], false)}, {prop: "Id", name: "Id", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$30.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([ptrType$15], [$error], false)}, {prop: "Id", name: "Id", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$39.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([ptrType$15], [$error], false)}, {prop: "Id", name: "Id", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$56.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([ptrType$15], [$error], false)}, {prop: "InitPayload", name: "InitPayload", pkg: "", typ: $funcType([sliceType$1], [], false)}, {prop: "Payload", name: "Payload", pkg: "", typ: $funcType([], [sliceType$1], false)}, {prop: "Id", name: "Id", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$62.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([ptrType$15], [$error], false)}, {prop: "Id", name: "Id", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$49.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([ptrType$15], [$error], false)}, {prop: "Id", name: "Id", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$27.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([ptrType$15], [$error], false)}, {prop: "Id", name: "Id", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$31.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([ptrType$15], [$error], false)}, {prop: "Id", name: "Id", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$40.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([ptrType$15], [$error], false)}, {prop: "Id", name: "Id", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$73.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([ptrType$15], [$error], false)}, {prop: "Id", name: "Id", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$21.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([ptrType$15], [$error], false)}, {prop: "Id", name: "Id", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$52.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([ptrType$15], [$error], false)}, {prop: "Id", name: "Id", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$74.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([ptrType$15], [$error], false)}, {prop: "Id", name: "Id", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$32.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([ptrType$15], [$error], false)}, {prop: "Id", name: "Id", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$41.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([ptrType$15], [$error], false)}, {prop: "Id", name: "Id", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$63.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([ptrType$15], [$error], false)}, {prop: "Id", name: "Id", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$33.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([ptrType$15], [$error], false)}, {prop: "Id", name: "Id", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$42.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([ptrType$15], [$error], false)}, {prop: "Id", name: "Id", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$28.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([ptrType$15], [$error], false)}, {prop: "Id", name: "Id", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$22.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([ptrType$15], [$error], false)}, {prop: "Id", name: "Id", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$53.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([ptrType$15], [$error], false)}, {prop: "Id", name: "Id", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$61.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([ptrType$15], [$error], false)}, {prop: "Id", name: "Id", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$75.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([ptrType$15], [$error], false)}, {prop: "Id", name: "Id", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$43.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([ptrType$15], [$error], false)}, {prop: "Id", name: "Id", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$64.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([ptrType$15], [$error], false)}, {prop: "Id", name: "Id", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$76.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([ptrType$15], [$error], false)}, {prop: "Id", name: "Id", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$77.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([ptrType$15], [$error], false)}, {prop: "Id", name: "Id", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$78.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([ptrType$15], [$error], false)}, {prop: "Id", name: "Id", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$46.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([ptrType$15], [$error], false)}, {prop: "Id", name: "Id", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$34.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([ptrType$15], [$error], false)}, {prop: "Id", name: "Id", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$35.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([ptrType$15], [$error], false)}, {prop: "Id", name: "Id", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$44.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([ptrType$15], [$error], false)}, {prop: "Id", name: "Id", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$65.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([ptrType$15], [$error], false)}, {prop: "Id", name: "Id", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$79.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([mapType], [], false)}];
	ptrType$80.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([mapType], [], false)}];
	ptrType$81.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([mapType], [], false)}];
	ptrType$82.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([mapType], [], false)}];
	ptrType$11.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([mapType], [], false)}];
	ptrType$83.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([mapType], [], false)}];
	ptrType$84.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([mapType], [], false)}];
	ptrType$14.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([mapType], [], false)}];
	ptrType$13.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([mapType], [], false)}];
	ptrType$86.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([mapType], [], false)}];
	ptrType$69.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([mapType], [], false)}];
	ptrType$68.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([mapType], [], false)}];
	ptrType$85.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([mapType], [], false)}];
	ptrType$87.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([mapType], [], false)}];
	ptrType$88.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([mapType], [], false)}];
	ptrType$89.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([mapType], [], false)}];
	ptrType$90.methods = [{prop: "Init", name: "Init", pkg: "", typ: $funcType([mapType], [], false)}];
	DescribeUser.init([{prop: "UserId", name: "UserId", pkg: "", typ: ptrType, tag: "json:\"user_id,omitempty\""}]);
	DiscardHistory.init([{prop: "MessageId", name: "MessageId", pkg: "", typ: ptrType, tag: "json:\"message_id\""}, {prop: "UserId", name: "UserId", pkg: "", typ: ptrType, tag: "json:\"user_id\""}]);
	LoadHistory.init([{prop: "ChannelId", name: "ChannelId", pkg: "", typ: ptrType, tag: "json:\"channel_id,omitempty\""}, {prop: "FilterProperty", name: "FilterProperty", pkg: "", typ: ptrType, tag: "json:\"filter_property,omitempty\""}, {prop: "FilterSubstring", name: "FilterSubstring", pkg: "", typ: ptrType, tag: "json:\"filter_substring,omitempty\""}, {prop: "HistoryLength", name: "HistoryLength", pkg: "", typ: ptrType$8, tag: "json:\"history_length,omitempty\""}, {prop: "HistoryOrder", name: "HistoryOrder", pkg: "", typ: ptrType$8, tag: "json:\"history_order,omitempty\""}, {prop: "MessageId", name: "MessageId", pkg: "", typ: ptrType, tag: "json:\"message_id,omitempty\""}, {prop: "MessageTypes", name: "MessageTypes", pkg: "", typ: sliceType, tag: "json:\"message_types,omitempty\""}, {prop: "UserId", name: "UserId", pkg: "", typ: ptrType, tag: "json:\"user_id,omitempty\""}]);
	UpdateDialogue.init([{prop: "DialogueStatus", name: "DialogueStatus", pkg: "", typ: ptrType, tag: "json:\"dialogue_status,omitempty\""}, {prop: "MemberAttrs", name: "MemberAttrs", pkg: "", typ: ptrType$58, tag: "json:\"member_attrs,omitempty\""}, {prop: "UserId", name: "UserId", pkg: "", typ: ptrType, tag: "json:\"user_id\""}]);
	UserInfoAttr.init([{prop: "Company", name: "Company", pkg: "", typ: ptrType, tag: "json:\"company,omitempty\""}, {prop: "Url", name: "Url", pkg: "", typ: ptrType, tag: "json:\"url,omitempty\""}]);
	RealmOwnerAccountAttr.init([{prop: "Channels", name: "Channels", pkg: "", typ: ptrType$68, tag: "json:\"channels\""}, {prop: "QueueMembers", name: "QueueMembers", pkg: "", typ: ptrType$69, tag: "json:\"queue_members\""}, {prop: "Queues", name: "Queues", pkg: "", typ: ptrType$68, tag: "json:\"queues\""}]);
	RealmThemeAttr.init([{prop: "Color", name: "Color", pkg: "", typ: ptrType, tag: "json:\"color,omitempty\""}]);
	ChannelAttrs.init([{prop: "Autohide", name: "Autohide", pkg: "", typ: $Bool, tag: "json:\"autohide,omitempty\""}, {prop: "Autosilence", name: "Autosilence", pkg: "", typ: $Bool, tag: "json:\"autosilence,omitempty\""}, {prop: "BlacklistedMessageTypes", name: "BlacklistedMessageTypes", pkg: "", typ: sliceType, tag: "json:\"blacklisted_message_types,omitempty\""}, {prop: "Closed", name: "Closed", pkg: "", typ: $Bool, tag: "json:\"closed,omitempty\""}, {prop: "DisclosedSince", name: "DisclosedSince", pkg: "", typ: ptrType$8, tag: "json:\"disclosed_since,omitempty\""}, {prop: "Followable", name: "Followable", pkg: "", typ: $Bool, tag: "json:\"followable,omitempty\""}, {prop: "Name", name: "Name", pkg: "", typ: ptrType, tag: "json:\"name,omitempty\""}, {prop: "OwnerId", name: "OwnerId", pkg: "", typ: ptrType, tag: "json:\"owner_id,omitempty\""}, {prop: "Private", name: "Private", pkg: "", typ: $Bool, tag: "json:\"private,omitempty\""}, {prop: "Public", name: "Public", pkg: "", typ: $Bool, tag: "json:\"public,omitempty\""}, {prop: "Ratelimit", name: "Ratelimit", pkg: "", typ: ptrType, tag: "json:\"ratelimit,omitempty\""}, {prop: "Suspended", name: "Suspended", pkg: "", typ: $Bool, tag: "json:\"suspended,omitempty\""}, {prop: "Topic", name: "Topic", pkg: "", typ: ptrType, tag: "json:\"topic,omitempty\""}, {prop: "Upload", name: "Upload", pkg: "", typ: ptrType, tag: "json:\"upload,omitempty\""}, {prop: "VerifiedJoin", name: "VerifiedJoin", pkg: "", typ: $Bool, tag: "json:\"verified_join,omitempty\""}]);
	ChannelMemberAttrs.init([{prop: "Autohide", name: "Autohide", pkg: "", typ: $Bool, tag: "json:\"autohide,omitempty\""}, {prop: "Moderator", name: "Moderator", pkg: "", typ: $Bool, tag: "json:\"moderator,omitempty\""}, {prop: "Operator", name: "Operator", pkg: "", typ: $Bool, tag: "json:\"operator,omitempty\""}, {prop: "Silenced", name: "Silenced", pkg: "", typ: $Bool, tag: "json:\"silenced,omitempty\""}, {prop: "Since", name: "Since", pkg: "", typ: ptrType$8, tag: "json:\"since,omitempty\""}]);
	DialogueMemberAttrs.init([{prop: "AudienceEnded", name: "AudienceEnded", pkg: "", typ: $Bool, tag: "json:\"audience_ended,omitempty\""}, {prop: "QueueId", name: "QueueId", pkg: "", typ: ptrType, tag: "json:\"queue_id,omitempty\""}, {prop: "Rating", name: "Rating", pkg: "", typ: ptrType$8, tag: "json:\"rating,omitempty\""}, {prop: "Writing", name: "Writing", pkg: "", typ: $Bool, tag: "json:\"writing,omitempty\""}]);
	IdentityAttrs.init([{prop: "Auth", name: "Auth", pkg: "", typ: $Bool, tag: "json:\"auth,omitempty\""}, {prop: "Blocked", name: "Blocked", pkg: "", typ: $Bool, tag: "json:\"blocked,omitempty\""}, {prop: "Pending", name: "Pending", pkg: "", typ: $Bool, tag: "json:\"pending,omitempty\""}, {prop: "Public", name: "Public", pkg: "", typ: $Bool, tag: "json:\"public,omitempty\""}, {prop: "Rejected", name: "Rejected", pkg: "", typ: $Bool, tag: "json:\"rejected,omitempty\""}]);
	PuppetAttrs.init([{prop: "Name", name: "Name", pkg: "", typ: ptrType, tag: "json:\"name,omitempty\""}]);
	QueueAttrs.init([{prop: "Capacity", name: "Capacity", pkg: "", typ: ptrType$8, tag: "json:\"capacity,omitempty\""}, {prop: "Closed", name: "Closed", pkg: "", typ: $Bool, tag: "json:\"closed,omitempty\""}, {prop: "Length", name: "Length", pkg: "", typ: ptrType$8, tag: "json:\"length,omitempty\""}, {prop: "Name", name: "Name", pkg: "", typ: ptrType, tag: "json:\"name,omitempty\""}, {prop: "Suspended", name: "Suspended", pkg: "", typ: $Bool, tag: "json:\"suspended,omitempty\""}, {prop: "Upload", name: "Upload", pkg: "", typ: ptrType, tag: "json:\"upload,omitempty\""}]);
	QueueMemberAttrs.init([]);
	RealmAttrs.init([{prop: "Name", name: "Name", pkg: "", typ: ptrType, tag: "json:\"name,omitempty\""}, {prop: "OwnerAccount", name: "OwnerAccount", pkg: "", typ: ptrType$67, tag: "json:\"owner_account,omitempty\""}, {prop: "OwnerId", name: "OwnerId", pkg: "", typ: ptrType, tag: "json:\"owner_id,omitempty\""}, {prop: "Suspended", name: "Suspended", pkg: "", typ: $Bool, tag: "json:\"suspended,omitempty\""}, {prop: "Theme", name: "Theme", pkg: "", typ: ptrType$70, tag: "json:\"theme,omitempty\""}]);
	RealmMemberAttrs.init([{prop: "Operator", name: "Operator", pkg: "", typ: $Bool, tag: "json:\"operator,omitempty\""}]);
	UserAttrs.init([{prop: "Admin", name: "Admin", pkg: "", typ: $Bool, tag: "json:\"admin,omitempty\""}, {prop: "Connected", name: "Connected", pkg: "", typ: $Bool, tag: "json:\"connected,omitempty\""}, {prop: "Deleted", name: "Deleted", pkg: "", typ: $Bool, tag: "json:\"deleted,omitempty\""}, {prop: "Guest", name: "Guest", pkg: "", typ: $Bool, tag: "json:\"guest,omitempty\""}, {prop: "Iconurl", name: "Iconurl", pkg: "", typ: ptrType, tag: "json:\"iconurl,omitempty\""}, {prop: "Idle", name: "Idle", pkg: "", typ: ptrType$8, tag: "json:\"idle,omitempty\""}, {prop: "Info", name: "Info", pkg: "", typ: ptrType$66, tag: "json:\"info,omitempty\""}, {prop: "Name", name: "Name", pkg: "", typ: ptrType, tag: "json:\"name,omitempty\""}, {prop: "Realname", name: "Realname", pkg: "", typ: ptrType, tag: "json:\"realname,omitempty\""}]);
	UnexpectedEventError.init([{prop: "Event", name: "Event", pkg: "", typ: ptrType$15, tag: ""}]);
	AccessCreated.init([{prop: "AccessKey", name: "AccessKey", pkg: "", typ: ptrType, tag: "json:\"access_key,omitempty\""}, {prop: "AccessType", name: "AccessType", pkg: "", typ: $String, tag: "json:\"access_type\""}, {prop: "EventId", name: "EventId", pkg: "", typ: $Int, tag: "json:\"event_id,omitempty\""}]);
	AccessFound.init([{prop: "AccessType", name: "AccessType", pkg: "", typ: $String, tag: "json:\"access_type\""}, {prop: "ChannelAttrs", name: "ChannelAttrs", pkg: "", typ: ptrType$1, tag: "json:\"channel_attrs,omitempty\""}, {prop: "ChannelId", name: "ChannelId", pkg: "", typ: ptrType, tag: "json:\"channel_id,omitempty\""}, {prop: "EventId", name: "EventId", pkg: "", typ: $Int, tag: "json:\"event_id,omitempty\""}, {prop: "IdentityName", name: "IdentityName", pkg: "", typ: ptrType, tag: "json:\"identity_name,omitempty\""}, {prop: "IdentityType", name: "IdentityType", pkg: "", typ: ptrType, tag: "json:\"identity_type,omitempty\""}, {prop: "RealmAttrs", name: "RealmAttrs", pkg: "", typ: ptrType$2, tag: "json:\"realm_attrs,omitempty\""}, {prop: "RealmId", name: "RealmId", pkg: "", typ: ptrType, tag: "json:\"realm_id,omitempty\""}, {prop: "RealmMember", name: "RealmMember", pkg: "", typ: $Bool, tag: "json:\"realm_member,omitempty\""}, {prop: "UserAttrs", name: "UserAttrs", pkg: "", typ: ptrType$3, tag: "json:\"user_attrs,omitempty\""}, {prop: "UserId", name: "UserId", pkg: "", typ: ptrType, tag: "json:\"user_id,omitempty\""}]);
	AudienceEnqueued.init([{prop: "EventId", name: "EventId", pkg: "", typ: $Int, tag: "json:\"event_id,omitempty\""}, {prop: "QueueAttrs", name: "QueueAttrs", pkg: "", typ: ptrType$4, tag: "json:\"queue_attrs\""}, {prop: "QueueId", name: "QueueId", pkg: "", typ: $String, tag: "json:\"queue_id\""}, {prop: "QueuePosition", name: "QueuePosition", pkg: "", typ: $Int, tag: "json:\"queue_position\""}]);
	ChannelDeleted.init([{prop: "ChannelId", name: "ChannelId", pkg: "", typ: $String, tag: "json:\"channel_id\""}, {prop: "EventId", name: "EventId", pkg: "", typ: $Int, tag: "json:\"event_id,omitempty\""}]);
	ChannelFound.init([{prop: "ChannelAttrs", name: "ChannelAttrs", pkg: "", typ: ptrType$1, tag: "json:\"channel_attrs\""}, {prop: "ChannelId", name: "ChannelId", pkg: "", typ: $String, tag: "json:\"channel_id\""}, {prop: "ChannelMembers", name: "ChannelMembers", pkg: "", typ: mapType$1, tag: "json:\"channel_members,omitempty\""}, {prop: "ChannelStatus", name: "ChannelStatus", pkg: "", typ: ptrType, tag: "json:\"channel_status,omitempty\""}, {prop: "EventId", name: "EventId", pkg: "", typ: $Int, tag: "json:\"event_id,omitempty\""}, {prop: "RealmId", name: "RealmId", pkg: "", typ: ptrType, tag: "json:\"realm_id,omitempty\""}]);
	ChannelJoined.init([{prop: "ChannelAttrs", name: "ChannelAttrs", pkg: "", typ: ptrType$1, tag: "json:\"channel_attrs\""}, {prop: "ChannelId", name: "ChannelId", pkg: "", typ: $String, tag: "json:\"channel_id\""}, {prop: "ChannelMembers", name: "ChannelMembers", pkg: "", typ: mapType$1, tag: "json:\"channel_members\""}, {prop: "EventId", name: "EventId", pkg: "", typ: $Int, tag: "json:\"event_id,omitempty\""}, {prop: "RealmId", name: "RealmId", pkg: "", typ: ptrType, tag: "json:\"realm_id,omitempty\""}]);
	ChannelMemberJoined.init([{prop: "ChannelId", name: "ChannelId", pkg: "", typ: $String, tag: "json:\"channel_id\""}, {prop: "EventId", name: "EventId", pkg: "", typ: $Int, tag: "json:\"event_id,omitempty\""}, {prop: "MemberAttrs", name: "MemberAttrs", pkg: "", typ: ptrType$5, tag: "json:\"member_attrs\""}, {prop: "PuppetAttrs", name: "PuppetAttrs", pkg: "", typ: ptrType$6, tag: "json:\"puppet_attrs,omitempty\""}, {prop: "UserAttrs", name: "UserAttrs", pkg: "", typ: ptrType$3, tag: "json:\"user_attrs\""}, {prop: "UserId", name: "UserId", pkg: "", typ: $String, tag: "json:\"user_id\""}]);
	ChannelMemberParted.init([{prop: "ChannelId", name: "ChannelId", pkg: "", typ: ptrType, tag: "json:\"channel_id,omitempty\""}, {prop: "EventId", name: "EventId", pkg: "", typ: $Int, tag: "json:\"event_id,omitempty\""}, {prop: "RealmId", name: "RealmId", pkg: "", typ: ptrType, tag: "json:\"realm_id,omitempty\""}, {prop: "UserId", name: "UserId", pkg: "", typ: $String, tag: "json:\"user_id\""}]);
	ChannelMemberUpdated.init([{prop: "ChannelId", name: "ChannelId", pkg: "", typ: ptrType, tag: "json:\"channel_id,omitempty\""}, {prop: "EventId", name: "EventId", pkg: "", typ: $Int, tag: "json:\"event_id,omitempty\""}, {prop: "MemberAttrs", name: "MemberAttrs", pkg: "", typ: ptrType$5, tag: "json:\"member_attrs\""}, {prop: "RealmId", name: "RealmId", pkg: "", typ: ptrType, tag: "json:\"realm_id,omitempty\""}, {prop: "UserId", name: "UserId", pkg: "", typ: $String, tag: "json:\"user_id\""}]);
	ChannelParted.init([{prop: "ChannelId", name: "ChannelId", pkg: "", typ: $String, tag: "json:\"channel_id\""}, {prop: "EventId", name: "EventId", pkg: "", typ: $Int, tag: "json:\"event_id,omitempty\""}]);
	ChannelUpdated.init([{prop: "ChannelAttrs", name: "ChannelAttrs", pkg: "", typ: ptrType$1, tag: "json:\"channel_attrs\""}, {prop: "ChannelId", name: "ChannelId", pkg: "", typ: $String, tag: "json:\"channel_id\""}, {prop: "EventId", name: "EventId", pkg: "", typ: $Int, tag: "json:\"event_id,omitempty\""}, {prop: "RealmId", name: "RealmId", pkg: "", typ: ptrType, tag: "json:\"realm_id,omitempty\""}]);
	DialogueUpdated.init([{prop: "AudienceMetadata", name: "AudienceMetadata", pkg: "", typ: mapType, tag: "json:\"audience_metadata,omitempty\""}, {prop: "DialogueMembers", name: "DialogueMembers", pkg: "", typ: mapType$2, tag: "json:\"dialogue_members\""}, {prop: "DialogueStatus", name: "DialogueStatus", pkg: "", typ: ptrType, tag: "json:\"dialogue_status,omitempty\""}, {prop: "EventId", name: "EventId", pkg: "", typ: $Int, tag: "json:\"event_id,omitempty\""}, {prop: "UserId", name: "UserId", pkg: "", typ: $String, tag: "json:\"user_id\""}]);
	Error.init([{prop: "ChannelId", name: "ChannelId", pkg: "", typ: ptrType, tag: "json:\"channel_id,omitempty\""}, {prop: "ErrorReason", name: "ErrorReason", pkg: "", typ: ptrType, tag: "json:\"error_reason,omitempty\""}, {prop: "ErrorType", name: "ErrorType", pkg: "", typ: $String, tag: "json:\"error_type\""}, {prop: "EventId", name: "EventId", pkg: "", typ: $Int, tag: "json:\"event_id,omitempty\""}, {prop: "IdentityName", name: "IdentityName", pkg: "", typ: ptrType, tag: "json:\"identity_name,omitempty\""}, {prop: "IdentityType", name: "IdentityType", pkg: "", typ: ptrType, tag: "json:\"identity_type,omitempty\""}, {prop: "MessageType", name: "MessageType", pkg: "", typ: ptrType, tag: "json:\"message_type,omitempty\""}, {prop: "QueueId", name: "QueueId", pkg: "", typ: ptrType, tag: "json:\"queue_id,omitempty\""}, {prop: "RealmId", name: "RealmId", pkg: "", typ: ptrType, tag: "json:\"realm_id,omitempty\""}, {prop: "UserId", name: "UserId", pkg: "", typ: ptrType, tag: "json:\"user_id,omitempty\""}]);
	HistoryDiscarded.init([{prop: "ChannelId", name: "ChannelId", pkg: "", typ: ptrType, tag: "json:\"channel_id,omitempty\""}, {prop: "EventId", name: "EventId", pkg: "", typ: $Int, tag: "json:\"event_id,omitempty\""}, {prop: "MessageId", name: "MessageId", pkg: "", typ: $String, tag: "json:\"message_id\""}, {prop: "UserId", name: "UserId", pkg: "", typ: ptrType, tag: "json:\"user_id,omitempty\""}]);
	HistoryResults.init([{prop: "ChannelId", name: "ChannelId", pkg: "", typ: ptrType, tag: "json:\"channel_id,omitempty\""}, {prop: "EventId", name: "EventId", pkg: "", typ: $Int, tag: "json:\"event_id,omitempty\""}, {prop: "HistoryLength", name: "HistoryLength", pkg: "", typ: $Int, tag: "json:\"history_length\""}, {prop: "MessageId", name: "MessageId", pkg: "", typ: ptrType, tag: "json:\"message_id,omitempty\""}, {prop: "UserId", name: "UserId", pkg: "", typ: ptrType, tag: "json:\"user_id,omitempty\""}]);
	IdentityCreated.init([{prop: "EventId", name: "EventId", pkg: "", typ: $Int, tag: "json:\"event_id,omitempty\""}, {prop: "IdentityAttrs", name: "IdentityAttrs", pkg: "", typ: ptrType$7, tag: "json:\"identity_attrs\""}, {prop: "IdentityName", name: "IdentityName", pkg: "", typ: $String, tag: "json:\"identity_name\""}, {prop: "IdentityType", name: "IdentityType", pkg: "", typ: $String, tag: "json:\"identity_type\""}]);
	IdentityDeleted.init([{prop: "EventId", name: "EventId", pkg: "", typ: $Int, tag: "json:\"event_id,omitempty\""}, {prop: "IdentityName", name: "IdentityName", pkg: "", typ: $String, tag: "json:\"identity_name\""}, {prop: "IdentityType", name: "IdentityType", pkg: "", typ: $String, tag: "json:\"identity_type\""}]);
	IdentityFound.init([{prop: "EventId", name: "EventId", pkg: "", typ: $Int, tag: "json:\"event_id,omitempty\""}, {prop: "IdentityAttrs", name: "IdentityAttrs", pkg: "", typ: ptrType$7, tag: "json:\"identity_attrs,omitempty\""}, {prop: "IdentityName", name: "IdentityName", pkg: "", typ: $String, tag: "json:\"identity_name\""}, {prop: "IdentityType", name: "IdentityType", pkg: "", typ: $String, tag: "json:\"identity_type\""}, {prop: "UserId", name: "UserId", pkg: "", typ: $String, tag: "json:\"user_id\""}]);
	IdentityUpdated.init([{prop: "EventId", name: "EventId", pkg: "", typ: $Int, tag: "json:\"event_id,omitempty\""}, {prop: "IdentityAttrs", name: "IdentityAttrs", pkg: "", typ: ptrType$7, tag: "json:\"identity_attrs\""}, {prop: "IdentityName", name: "IdentityName", pkg: "", typ: $String, tag: "json:\"identity_name\""}, {prop: "IdentityType", name: "IdentityType", pkg: "", typ: $String, tag: "json:\"identity_type\""}]);
	MasterKeyCreated.init([{prop: "EventId", name: "EventId", pkg: "", typ: $Int, tag: "json:\"event_id,omitempty\""}, {prop: "MasterKeyId", name: "MasterKeyId", pkg: "", typ: $String, tag: "json:\"master_key_id\""}, {prop: "MasterKeySecret", name: "MasterKeySecret", pkg: "", typ: ptrType, tag: "json:\"master_key_secret,omitempty\""}, {prop: "MasterKeyType", name: "MasterKeyType", pkg: "", typ: $String, tag: "json:\"master_key_type\""}]);
	MasterKeyDeleted.init([{prop: "EventId", name: "EventId", pkg: "", typ: $Int, tag: "json:\"event_id,omitempty\""}, {prop: "MasterKeyId", name: "MasterKeyId", pkg: "", typ: $String, tag: "json:\"master_key_id\""}, {prop: "MasterKeyType", name: "MasterKeyType", pkg: "", typ: $String, tag: "json:\"master_key_type\""}]);
	MasterKeysFound.init([{prop: "EventId", name: "EventId", pkg: "", typ: $Int, tag: "json:\"event_id,omitempty\""}, {prop: "MasterKeys", name: "MasterKeys", pkg: "", typ: mapType$4, tag: "json:\"master_keys\""}]);
	MessageReceived.init([{prop: "ChannelId", name: "ChannelId", pkg: "", typ: ptrType, tag: "json:\"channel_id,omitempty\""}, {prop: "EventId", name: "EventId", pkg: "", typ: $Int, tag: "json:\"event_id,omitempty\""}, {prop: "HistoryLength", name: "HistoryLength", pkg: "", typ: ptrType$8, tag: "json:\"history_length,omitempty\""}, {prop: "MessageFold", name: "MessageFold", pkg: "", typ: $Bool, tag: "json:\"message_fold,omitempty\""}, {prop: "MessageHidden", name: "MessageHidden", pkg: "", typ: $Bool, tag: "json:\"message_hidden,omitempty\""}, {prop: "MessageId", name: "MessageId", pkg: "", typ: $String, tag: "json:\"message_id\""}, {prop: "MessageRecipientIds", name: "MessageRecipientIds", pkg: "", typ: sliceType, tag: "json:\"message_recipient_ids,omitempty\""}, {prop: "MessageTime", name: "MessageTime", pkg: "", typ: $Float64, tag: "json:\"message_time\""}, {prop: "MessageTtl", name: "MessageTtl", pkg: "", typ: ptrType$9, tag: "json:\"message_ttl,omitempty\""}, {prop: "MessageType", name: "MessageType", pkg: "", typ: $String, tag: "json:\"message_type\""}, {prop: "MessageUserId", name: "MessageUserId", pkg: "", typ: ptrType, tag: "json:\"message_user_id,omitempty\""}, {prop: "MessageUserName", name: "MessageUserName", pkg: "", typ: ptrType, tag: "json:\"message_user_name,omitempty\""}, {prop: "UserId", name: "UserId", pkg: "", typ: ptrType, tag: "json:\"user_id,omitempty\""}, {prop: "payload", name: "payload", pkg: "github.com/ninchat/ninchat-go/ninchatapi", typ: sliceType$1, tag: ""}]);
	MessageUpdated.init([{prop: "ChannelId", name: "ChannelId", pkg: "", typ: ptrType, tag: "json:\"channel_id,omitempty\""}, {prop: "EventId", name: "EventId", pkg: "", typ: $Int, tag: "json:\"event_id,omitempty\""}, {prop: "MessageHidden", name: "MessageHidden", pkg: "", typ: $Bool, tag: "json:\"message_hidden,omitempty\""}, {prop: "MessageId", name: "MessageId", pkg: "", typ: $String, tag: "json:\"message_id\""}]);
	Pong.init([{prop: "EventId", name: "EventId", pkg: "", typ: $Int, tag: "json:\"event_id,omitempty\""}]);
	QueueCreated.init([{prop: "EventId", name: "EventId", pkg: "", typ: $Int, tag: "json:\"event_id,omitempty\""}, {prop: "QueueAttrs", name: "QueueAttrs", pkg: "", typ: ptrType$4, tag: "json:\"queue_attrs\""}, {prop: "QueueId", name: "QueueId", pkg: "", typ: $String, tag: "json:\"queue_id\""}, {prop: "RealmId", name: "RealmId", pkg: "", typ: ptrType, tag: "json:\"realm_id,omitempty\""}]);
	QueueDeleted.init([{prop: "EventId", name: "EventId", pkg: "", typ: $Int, tag: "json:\"event_id,omitempty\""}, {prop: "QueueId", name: "QueueId", pkg: "", typ: $String, tag: "json:\"queue_id\""}, {prop: "RealmId", name: "RealmId", pkg: "", typ: ptrType, tag: "json:\"realm_id,omitempty\""}]);
	QueueFound.init([{prop: "EventId", name: "EventId", pkg: "", typ: $Int, tag: "json:\"event_id,omitempty\""}, {prop: "QueueAttrs", name: "QueueAttrs", pkg: "", typ: ptrType$4, tag: "json:\"queue_attrs\""}, {prop: "QueueId", name: "QueueId", pkg: "", typ: $String, tag: "json:\"queue_id\""}, {prop: "QueueMembers", name: "QueueMembers", pkg: "", typ: mapType$5, tag: "json:\"queue_members,omitempty\""}, {prop: "QueuePosition", name: "QueuePosition", pkg: "", typ: ptrType$8, tag: "json:\"queue_position,omitempty\""}, {prop: "RealmId", name: "RealmId", pkg: "", typ: ptrType, tag: "json:\"realm_id,omitempty\""}]);
	QueueJoined.init([{prop: "EventId", name: "EventId", pkg: "", typ: $Int, tag: "json:\"event_id,omitempty\""}, {prop: "QueueAttrs", name: "QueueAttrs", pkg: "", typ: ptrType$4, tag: "json:\"queue_attrs\""}, {prop: "QueueId", name: "QueueId", pkg: "", typ: $String, tag: "json:\"queue_id\""}, {prop: "RealmId", name: "RealmId", pkg: "", typ: ptrType, tag: "json:\"realm_id,omitempty\""}]);
	QueueMemberJoined.init([{prop: "EventId", name: "EventId", pkg: "", typ: $Int, tag: "json:\"event_id,omitempty\""}, {prop: "MemberAttrs", name: "MemberAttrs", pkg: "", typ: ptrType$10, tag: "json:\"member_attrs\""}, {prop: "QueueId", name: "QueueId", pkg: "", typ: $String, tag: "json:\"queue_id\""}, {prop: "UserAttrs", name: "UserAttrs", pkg: "", typ: ptrType$3, tag: "json:\"user_attrs\""}, {prop: "UserId", name: "UserId", pkg: "", typ: $String, tag: "json:\"user_id\""}]);
	QueueMemberParted.init([{prop: "EventId", name: "EventId", pkg: "", typ: $Int, tag: "json:\"event_id,omitempty\""}, {prop: "QueueId", name: "QueueId", pkg: "", typ: $String, tag: "json:\"queue_id\""}, {prop: "UserId", name: "UserId", pkg: "", typ: $String, tag: "json:\"user_id\""}]);
	QueueParted.init([{prop: "EventId", name: "EventId", pkg: "", typ: $Int, tag: "json:\"event_id,omitempty\""}, {prop: "QueueId", name: "QueueId", pkg: "", typ: $String, tag: "json:\"queue_id\""}, {prop: "RealmId", name: "RealmId", pkg: "", typ: ptrType, tag: "json:\"realm_id,omitempty\""}]);
	QueueTranscriptsDeleted.init([{prop: "EventId", name: "EventId", pkg: "", typ: $Int, tag: "json:\"event_id,omitempty\""}, {prop: "IntervalBegin", name: "IntervalBegin", pkg: "", typ: $Float64, tag: "json:\"interval_begin\""}, {prop: "IntervalEnd", name: "IntervalEnd", pkg: "", typ: $Float64, tag: "json:\"interval_end\""}, {prop: "QueueId", name: "QueueId", pkg: "", typ: $String, tag: "json:\"queue_id\""}]);
	QueueTranscriptsFound.init([{prop: "EventId", name: "EventId", pkg: "", typ: $Int, tag: "json:\"event_id,omitempty\""}, {prop: "QueueId", name: "QueueId", pkg: "", typ: $String, tag: "json:\"queue_id\""}, {prop: "QueueTranscripts", name: "QueueTranscripts", pkg: "", typ: sliceType$2, tag: "json:\"queue_transcripts\""}]);
	QueueUpdated.init([{prop: "EventId", name: "EventId", pkg: "", typ: $Int, tag: "json:\"event_id,omitempty\""}, {prop: "QueueAttrs", name: "QueueAttrs", pkg: "", typ: ptrType$4, tag: "json:\"queue_attrs\""}, {prop: "QueueId", name: "QueueId", pkg: "", typ: $String, tag: "json:\"queue_id\""}, {prop: "QueuePosition", name: "QueuePosition", pkg: "", typ: ptrType$8, tag: "json:\"queue_position,omitempty\""}, {prop: "RealmId", name: "RealmId", pkg: "", typ: ptrType, tag: "json:\"realm_id,omitempty\""}]);
	RealmDeleted.init([{prop: "EventId", name: "EventId", pkg: "", typ: $Int, tag: "json:\"event_id,omitempty\""}, {prop: "RealmId", name: "RealmId", pkg: "", typ: $String, tag: "json:\"realm_id\""}]);
	RealmFound.init([{prop: "EventId", name: "EventId", pkg: "", typ: $Int, tag: "json:\"event_id,omitempty\""}, {prop: "RealmAttrs", name: "RealmAttrs", pkg: "", typ: ptrType$2, tag: "json:\"realm_attrs\""}, {prop: "RealmId", name: "RealmId", pkg: "", typ: $String, tag: "json:\"realm_id\""}, {prop: "RealmMembers", name: "RealmMembers", pkg: "", typ: mapType$6, tag: "json:\"realm_members,omitempty\""}]);
	RealmJoined.init([{prop: "EventId", name: "EventId", pkg: "", typ: $Int, tag: "json:\"event_id,omitempty\""}, {prop: "RealmAttrs", name: "RealmAttrs", pkg: "", typ: ptrType$2, tag: "json:\"realm_attrs\""}, {prop: "RealmId", name: "RealmId", pkg: "", typ: $String, tag: "json:\"realm_id\""}, {prop: "RealmMembers", name: "RealmMembers", pkg: "", typ: mapType$6, tag: "json:\"realm_members\""}]);
	RealmMemberJoined.init([{prop: "EventId", name: "EventId", pkg: "", typ: $Int, tag: "json:\"event_id,omitempty\""}, {prop: "MemberAttrs", name: "MemberAttrs", pkg: "", typ: ptrType$12, tag: "json:\"member_attrs\""}, {prop: "PuppetAttrs", name: "PuppetAttrs", pkg: "", typ: ptrType$6, tag: "json:\"puppet_attrs,omitempty\""}, {prop: "RealmId", name: "RealmId", pkg: "", typ: $String, tag: "json:\"realm_id\""}, {prop: "UserAttrs", name: "UserAttrs", pkg: "", typ: ptrType$3, tag: "json:\"user_attrs\""}, {prop: "UserId", name: "UserId", pkg: "", typ: $String, tag: "json:\"user_id\""}]);
	RealmMemberParted.init([{prop: "ChannelId", name: "ChannelId", pkg: "", typ: ptrType, tag: "json:\"channel_id,omitempty\""}, {prop: "EventId", name: "EventId", pkg: "", typ: $Int, tag: "json:\"event_id,omitempty\""}, {prop: "RealmId", name: "RealmId", pkg: "", typ: ptrType, tag: "json:\"realm_id,omitempty\""}, {prop: "UserId", name: "UserId", pkg: "", typ: $String, tag: "json:\"user_id\""}]);
	RealmMemberUpdated.init([{prop: "EventId", name: "EventId", pkg: "", typ: $Int, tag: "json:\"event_id,omitempty\""}, {prop: "MemberAttrs", name: "MemberAttrs", pkg: "", typ: ptrType$12, tag: "json:\"member_attrs\""}, {prop: "RealmId", name: "RealmId", pkg: "", typ: $String, tag: "json:\"realm_id\""}, {prop: "UserId", name: "UserId", pkg: "", typ: $String, tag: "json:\"user_id\""}]);
	RealmParted.init([{prop: "EventId", name: "EventId", pkg: "", typ: $Int, tag: "json:\"event_id,omitempty\""}, {prop: "RealmId", name: "RealmId", pkg: "", typ: $String, tag: "json:\"realm_id\""}]);
	RealmQueuesFound.init([{prop: "EventId", name: "EventId", pkg: "", typ: $Int, tag: "json:\"event_id,omitempty\""}, {prop: "RealmId", name: "RealmId", pkg: "", typ: $String, tag: "json:\"realm_id\""}, {prop: "RealmQueues", name: "RealmQueues", pkg: "", typ: mapType$7, tag: "json:\"realm_queues\""}]);
	RealmUpdated.init([{prop: "EventId", name: "EventId", pkg: "", typ: $Int, tag: "json:\"event_id,omitempty\""}, {prop: "RealmAttrs", name: "RealmAttrs", pkg: "", typ: ptrType$2, tag: "json:\"realm_attrs\""}, {prop: "RealmId", name: "RealmId", pkg: "", typ: $String, tag: "json:\"realm_id\""}]);
	SearchResults.init([{prop: "Channels", name: "Channels", pkg: "", typ: mapType$8, tag: "json:\"channels,omitempty\""}, {prop: "EventId", name: "EventId", pkg: "", typ: $Int, tag: "json:\"event_id,omitempty\""}, {prop: "Users", name: "Users", pkg: "", typ: mapType$9, tag: "json:\"users,omitempty\""}]);
	SessionCreated.init([{prop: "EventId", name: "EventId", pkg: "", typ: $Int, tag: "json:\"event_id,omitempty\""}, {prop: "PuppetMasters", name: "PuppetMasters", pkg: "", typ: mapType$10, tag: "json:\"puppet_masters,omitempty\""}, {prop: "SessionHost", name: "SessionHost", pkg: "", typ: ptrType, tag: "json:\"session_host,omitempty\""}, {prop: "SessionId", name: "SessionId", pkg: "", typ: $String, tag: "json:\"session_id\""}, {prop: "UserAccount", name: "UserAccount", pkg: "", typ: ptrType$13, tag: "json:\"user_account\""}, {prop: "UserAttrs", name: "UserAttrs", pkg: "", typ: ptrType$3, tag: "json:\"user_attrs\""}, {prop: "UserAuth", name: "UserAuth", pkg: "", typ: ptrType, tag: "json:\"user_auth,omitempty\""}, {prop: "UserChannels", name: "UserChannels", pkg: "", typ: mapType$11, tag: "json:\"user_channels\""}, {prop: "UserDialogues", name: "UserDialogues", pkg: "", typ: mapType$12, tag: "json:\"user_dialogues\""}, {prop: "UserId", name: "UserId", pkg: "", typ: $String, tag: "json:\"user_id\""}, {prop: "UserIdentities", name: "UserIdentities", pkg: "", typ: mapType$14, tag: "json:\"user_identities\""}, {prop: "UserQueues", name: "UserQueues", pkg: "", typ: mapType$15, tag: "json:\"user_queues,omitempty\""}, {prop: "UserRealms", name: "UserRealms", pkg: "", typ: mapType$16, tag: "json:\"user_realms\""}, {prop: "UserRealmsMember", name: "UserRealmsMember", pkg: "", typ: mapType$17, tag: "json:\"user_realms_member,omitempty\""}, {prop: "UserSettings", name: "UserSettings", pkg: "", typ: mapType, tag: "json:\"user_settings\""}]);
	SessionStatusUpdated.init([{prop: "ChannelId", name: "ChannelId", pkg: "", typ: ptrType, tag: "json:\"channel_id,omitempty\""}, {prop: "EventId", name: "EventId", pkg: "", typ: $Int, tag: "json:\"event_id,omitempty\""}, {prop: "MessageId", name: "MessageId", pkg: "", typ: $String, tag: "json:\"message_id\""}, {prop: "UserId", name: "UserId", pkg: "", typ: ptrType, tag: "json:\"user_id,omitempty\""}]);
	TranscriptContents.init([{prop: "AudienceMetadata", name: "AudienceMetadata", pkg: "", typ: mapType, tag: "json:\"audience_metadata,omitempty\""}, {prop: "DialogueMembers", name: "DialogueMembers", pkg: "", typ: mapType$2, tag: "json:\"dialogue_members,omitempty\""}, {prop: "EventId", name: "EventId", pkg: "", typ: $Int, tag: "json:\"event_id,omitempty\""}, {prop: "MessageId", name: "MessageId", pkg: "", typ: ptrType, tag: "json:\"message_id,omitempty\""}, {prop: "TranscriptMessages", name: "TranscriptMessages", pkg: "", typ: sliceType$3, tag: "json:\"transcript_messages\""}]);
	TranscriptDeleted.init([{prop: "DialogueId", name: "DialogueId", pkg: "", typ: sliceType, tag: "json:\"dialogue_id,omitempty\""}, {prop: "EventId", name: "EventId", pkg: "", typ: $Int, tag: "json:\"event_id,omitempty\""}]);
	UserDeleted.init([{prop: "EventId", name: "EventId", pkg: "", typ: $Int, tag: "json:\"event_id,omitempty\""}, {prop: "UserId", name: "UserId", pkg: "", typ: $String, tag: "json:\"user_id\""}]);
	UserFound.init([{prop: "AudienceMetadata", name: "AudienceMetadata", pkg: "", typ: mapType, tag: "json:\"audience_metadata,omitempty\""}, {prop: "DialogueMembers", name: "DialogueMembers", pkg: "", typ: mapType$2, tag: "json:\"dialogue_members,omitempty\""}, {prop: "DialogueStatus", name: "DialogueStatus", pkg: "", typ: ptrType, tag: "json:\"dialogue_status,omitempty\""}, {prop: "EventId", name: "EventId", pkg: "", typ: $Int, tag: "json:\"event_id,omitempty\""}, {prop: "PuppetMasters", name: "PuppetMasters", pkg: "", typ: mapType$10, tag: "json:\"puppet_masters,omitempty\""}, {prop: "UserAccount", name: "UserAccount", pkg: "", typ: ptrType$13, tag: "json:\"user_account,omitempty\""}, {prop: "UserAttrs", name: "UserAttrs", pkg: "", typ: ptrType$3, tag: "json:\"user_attrs\""}, {prop: "UserChannels", name: "UserChannels", pkg: "", typ: mapType$11, tag: "json:\"user_channels,omitempty\""}, {prop: "UserDialogues", name: "UserDialogues", pkg: "", typ: mapType$12, tag: "json:\"user_dialogues,omitempty\""}, {prop: "UserId", name: "UserId", pkg: "", typ: $String, tag: "json:\"user_id\""}, {prop: "UserIdentities", name: "UserIdentities", pkg: "", typ: mapType$14, tag: "json:\"user_identities\""}, {prop: "UserQueues", name: "UserQueues", pkg: "", typ: mapType$15, tag: "json:\"user_queues,omitempty\""}, {prop: "UserRealms", name: "UserRealms", pkg: "", typ: mapType$16, tag: "json:\"user_realms,omitempty\""}, {prop: "UserRealmsMember", name: "UserRealmsMember", pkg: "", typ: mapType$17, tag: "json:\"user_realms_member,omitempty\""}, {prop: "UserSettings", name: "UserSettings", pkg: "", typ: mapType, tag: "json:\"user_settings,omitempty\""}]);
	UserUpdated.init([{prop: "EventId", name: "EventId", pkg: "", typ: $Int, tag: "json:\"event_id,omitempty\""}, {prop: "PuppetMasters", name: "PuppetMasters", pkg: "", typ: mapType$10, tag: "json:\"puppet_masters,omitempty\""}, {prop: "UserAccount", name: "UserAccount", pkg: "", typ: ptrType$13, tag: "json:\"user_account,omitempty\""}, {prop: "UserAttrs", name: "UserAttrs", pkg: "", typ: ptrType$3, tag: "json:\"user_attrs\""}, {prop: "UserId", name: "UserId", pkg: "", typ: $String, tag: "json:\"user_id\""}, {prop: "UserSettings", name: "UserSettings", pkg: "", typ: mapType, tag: "json:\"user_settings,omitempty\""}]);
	ChannelMember.init([{prop: "MemberAttrs", name: "MemberAttrs", pkg: "", typ: ptrType$5, tag: "json:\"member_attrs\""}, {prop: "PuppetAttrs", name: "PuppetAttrs", pkg: "", typ: ptrType$6, tag: "json:\"puppet_attrs,omitempty\""}, {prop: "UserAttrs", name: "UserAttrs", pkg: "", typ: ptrType$3, tag: "json:\"user_attrs\""}]);
	ChannelResult.init([{prop: "ChannelAttrs", name: "ChannelAttrs", pkg: "", typ: ptrType$1, tag: "json:\"channel_attrs\""}, {prop: "RealmId", name: "RealmId", pkg: "", typ: ptrType, tag: "json:\"realm_id,omitempty\""}, {prop: "Weight", name: "Weight", pkg: "", typ: $Float64, tag: "json:\"weight\""}]);
	PuppetMaster.init([{prop: "PuppetAttrs", name: "PuppetAttrs", pkg: "", typ: ptrType$6, tag: "json:\"puppet_attrs\""}]);
	QueueMember.init([{prop: "MemberAttrs", name: "MemberAttrs", pkg: "", typ: ptrType$10, tag: "json:\"member_attrs\""}, {prop: "UserAttrs", name: "UserAttrs", pkg: "", typ: ptrType$3, tag: "json:\"user_attrs\""}]);
	QueueTranscript.init([{prop: "AcceptTime", name: "AcceptTime", pkg: "", typ: $Float64, tag: "json:\"accept_time\""}, {prop: "AgentId", name: "AgentId", pkg: "", typ: $String, tag: "json:\"agent_id\""}, {prop: "CompleteTime", name: "CompleteTime", pkg: "", typ: $Float64, tag: "json:\"complete_time\""}, {prop: "DialogueId", name: "DialogueId", pkg: "", typ: sliceType, tag: "json:\"dialogue_id\""}, {prop: "FinishTime", name: "FinishTime", pkg: "", typ: $Float64, tag: "json:\"finish_time\""}, {prop: "Rating", name: "Rating", pkg: "", typ: ptrType$8, tag: "json:\"rating,omitempty\""}, {prop: "RequestTime", name: "RequestTime", pkg: "", typ: $Float64, tag: "json:\"request_time\""}]);
	RealmMember.init([{prop: "MemberAttrs", name: "MemberAttrs", pkg: "", typ: ptrType$12, tag: "json:\"member_attrs\""}, {prop: "PuppetAttrs", name: "PuppetAttrs", pkg: "", typ: ptrType$6, tag: "json:\"puppet_attrs,omitempty\""}, {prop: "UserAttrs", name: "UserAttrs", pkg: "", typ: ptrType$3, tag: "json:\"user_attrs\""}]);
	RealmQueue.init([{prop: "QueueAttrs", name: "QueueAttrs", pkg: "", typ: ptrType$4, tag: "json:\"queue_attrs\""}, {prop: "QueuePosition", name: "QueuePosition", pkg: "", typ: ptrType$8, tag: "json:\"queue_position,omitempty\""}]);
	TranscriptMessage.init([{prop: "MessageFold", name: "MessageFold", pkg: "", typ: $Bool, tag: "json:\"message_fold,omitempty\""}, {prop: "MessageId", name: "MessageId", pkg: "", typ: $String, tag: "json:\"message_id\""}, {prop: "MessageTime", name: "MessageTime", pkg: "", typ: $Float64, tag: "json:\"message_time\""}, {prop: "MessageType", name: "MessageType", pkg: "", typ: $String, tag: "json:\"message_type\""}, {prop: "MessageUserId", name: "MessageUserId", pkg: "", typ: ptrType, tag: "json:\"message_user_id,omitempty\""}, {prop: "MessageUserName", name: "MessageUserName", pkg: "", typ: ptrType, tag: "json:\"message_user_name,omitempty\""}, {prop: "Payload", name: "Payload", pkg: "", typ: $emptyInterface, tag: "json:\"payload\""}]);
	UserAccount.init([{prop: "Channels", name: "Channels", pkg: "", typ: ptrType$68, tag: "json:\"channels,omitempty\""}, {prop: "QueueMembers", name: "QueueMembers", pkg: "", typ: ptrType$69, tag: "json:\"queue_members,omitempty\""}, {prop: "Queues", name: "Queues", pkg: "", typ: ptrType$68, tag: "json:\"queues,omitempty\""}, {prop: "Realms", name: "Realms", pkg: "", typ: ptrType$68, tag: "json:\"realms,omitempty\""}, {prop: "Subscriptions", name: "Subscriptions", pkg: "", typ: sliceType$5, tag: "json:\"subscriptions,omitempty\""}, {prop: "Uploads", name: "Uploads", pkg: "", typ: ptrType$86, tag: "json:\"uploads,omitempty\""}]);
	UserAccountExtent.init([{prop: "Available", name: "Available", pkg: "", typ: $Float64, tag: "json:\"available\""}, {prop: "Quota", name: "Quota", pkg: "", typ: $Float64, tag: "json:\"quota\""}]);
	UserAccountMembers.init([{prop: "Quota", name: "Quota", pkg: "", typ: $Int, tag: "json:\"quota\""}]);
	UserAccountObjects.init([{prop: "Available", name: "Available", pkg: "", typ: $Int, tag: "json:\"available\""}, {prop: "Quota", name: "Quota", pkg: "", typ: $Int, tag: "json:\"quota\""}]);
	UserAccountSubscription.init([{prop: "Active", name: "Active", pkg: "", typ: $Bool, tag: "json:\"active\""}, {prop: "Channels", name: "Channels", pkg: "", typ: ptrType$68, tag: "json:\"channels,omitempty\""}, {prop: "Expiration", name: "Expiration", pkg: "", typ: ptrType$8, tag: "json:\"expiration,omitempty\""}, {prop: "Plan", name: "Plan", pkg: "", typ: $String, tag: "json:\"plan\""}, {prop: "QueueMembers", name: "QueueMembers", pkg: "", typ: ptrType$69, tag: "json:\"queue_members,omitempty\""}, {prop: "Queues", name: "Queues", pkg: "", typ: ptrType$68, tag: "json:\"queues,omitempty\""}, {prop: "Realms", name: "Realms", pkg: "", typ: ptrType$68, tag: "json:\"realms,omitempty\""}, {prop: "Renewal", name: "Renewal", pkg: "", typ: ptrType$8, tag: "json:\"renewal,omitempty\""}]);
	UserChannel.init([{prop: "ChannelAttrs", name: "ChannelAttrs", pkg: "", typ: ptrType$1, tag: "json:\"channel_attrs\""}, {prop: "ChannelStatus", name: "ChannelStatus", pkg: "", typ: ptrType, tag: "json:\"channel_status,omitempty\""}, {prop: "RealmId", name: "RealmId", pkg: "", typ: ptrType, tag: "json:\"realm_id,omitempty\""}]);
	UserDialogue.init([{prop: "AudienceMetadata", name: "AudienceMetadata", pkg: "", typ: mapType, tag: "json:\"audience_metadata,omitempty\""}, {prop: "DialogueMembers", name: "DialogueMembers", pkg: "", typ: mapType$2, tag: "json:\"dialogue_members,omitempty\""}, {prop: "DialogueStatus", name: "DialogueStatus", pkg: "", typ: ptrType, tag: "json:\"dialogue_status,omitempty\""}]);
	UserQueue.init([{prop: "QueueAttrs", name: "QueueAttrs", pkg: "", typ: ptrType$4, tag: "json:\"queue_attrs\""}, {prop: "RealmId", name: "RealmId", pkg: "", typ: $String, tag: "json:\"realm_id\""}]);
	UserResult.init([{prop: "UserAttrs", name: "UserAttrs", pkg: "", typ: ptrType$3, tag: "json:\"user_attrs\""}, {prop: "Weight", name: "Weight", pkg: "", typ: $Float64, tag: "json:\"weight\""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = ninchat.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$pkg.EventFactories = $makeMap($String.keyFor, [{ k: "access_created", v: (function() {
			var $ptr;
			return new AccessCreated.ptr(ptrType.nil, "", 0);
		}) }, { k: "access_found", v: (function() {
			var $ptr;
			return new AccessFound.ptr("", ptrType$1.nil, ptrType.nil, 0, ptrType.nil, ptrType.nil, ptrType$2.nil, ptrType.nil, false, ptrType$3.nil, ptrType.nil);
		}) }, { k: "audience_enqueued", v: (function() {
			var $ptr;
			return new AudienceEnqueued.ptr(0, ptrType$4.nil, "", 0);
		}) }, { k: "channel_deleted", v: (function() {
			var $ptr;
			return new ChannelDeleted.ptr("", 0);
		}) }, { k: "channel_found", v: (function() {
			var $ptr;
			return new ChannelFound.ptr(ptrType$1.nil, "", false, ptrType.nil, 0, ptrType.nil);
		}) }, { k: "channel_joined", v: (function() {
			var $ptr;
			return new ChannelJoined.ptr(ptrType$1.nil, "", false, 0, ptrType.nil);
		}) }, { k: "channel_member_joined", v: (function() {
			var $ptr;
			return new ChannelMemberJoined.ptr("", 0, ptrType$5.nil, ptrType$6.nil, ptrType$3.nil, "");
		}) }, { k: "channel_member_parted", v: (function() {
			var $ptr;
			return new ChannelMemberParted.ptr(ptrType.nil, 0, ptrType.nil, "");
		}) }, { k: "channel_member_updated", v: (function() {
			var $ptr;
			return new ChannelMemberUpdated.ptr(ptrType.nil, 0, ptrType$5.nil, ptrType.nil, "");
		}) }, { k: "channel_parted", v: (function() {
			var $ptr;
			return new ChannelParted.ptr("", 0);
		}) }, { k: "channel_updated", v: (function() {
			var $ptr;
			return new ChannelUpdated.ptr(ptrType$1.nil, "", 0, ptrType.nil);
		}) }, { k: "dialogue_updated", v: (function() {
			var $ptr;
			return new DialogueUpdated.ptr(false, false, ptrType.nil, 0, "");
		}) }, { k: "error", v: (function() {
			var $ptr;
			return new Error.ptr(ptrType.nil, ptrType.nil, "", 0, ptrType.nil, ptrType.nil, ptrType.nil, ptrType.nil, ptrType.nil, ptrType.nil);
		}) }, { k: "history_discarded", v: (function() {
			var $ptr;
			return new HistoryDiscarded.ptr(ptrType.nil, 0, "", ptrType.nil);
		}) }, { k: "history_results", v: (function() {
			var $ptr;
			return new HistoryResults.ptr(ptrType.nil, 0, 0, ptrType.nil, ptrType.nil);
		}) }, { k: "identity_created", v: (function() {
			var $ptr;
			return new IdentityCreated.ptr(0, ptrType$7.nil, "", "");
		}) }, { k: "identity_deleted", v: (function() {
			var $ptr;
			return new IdentityDeleted.ptr(0, "", "");
		}) }, { k: "identity_found", v: (function() {
			var $ptr;
			return new IdentityFound.ptr(0, ptrType$7.nil, "", "", "");
		}) }, { k: "identity_updated", v: (function() {
			var $ptr;
			return new IdentityUpdated.ptr(0, ptrType$7.nil, "", "");
		}) }, { k: "master_key_created", v: (function() {
			var $ptr;
			return new MasterKeyCreated.ptr(0, "", ptrType.nil, "");
		}) }, { k: "master_key_deleted", v: (function() {
			var $ptr;
			return new MasterKeyDeleted.ptr(0, "", "");
		}) }, { k: "master_keys_found", v: (function() {
			var $ptr;
			return new MasterKeysFound.ptr(0, false);
		}) }, { k: "message_received", v: (function() {
			var $ptr;
			return new MessageReceived.ptr(ptrType.nil, 0, ptrType$8.nil, false, false, "", sliceType.nil, 0, ptrType$9.nil, "", ptrType.nil, ptrType.nil, ptrType.nil, sliceType$1.nil);
		}) }, { k: "message_updated", v: (function() {
			var $ptr;
			return new MessageUpdated.ptr(ptrType.nil, 0, false, "");
		}) }, { k: "pong", v: (function() {
			var $ptr;
			return new Pong.ptr(0);
		}) }, { k: "queue_created", v: (function() {
			var $ptr;
			return new QueueCreated.ptr(0, ptrType$4.nil, "", ptrType.nil);
		}) }, { k: "queue_deleted", v: (function() {
			var $ptr;
			return new QueueDeleted.ptr(0, "", ptrType.nil);
		}) }, { k: "queue_found", v: (function() {
			var $ptr;
			return new QueueFound.ptr(0, ptrType$4.nil, "", false, ptrType$8.nil, ptrType.nil);
		}) }, { k: "queue_joined", v: (function() {
			var $ptr;
			return new QueueJoined.ptr(0, ptrType$4.nil, "", ptrType.nil);
		}) }, { k: "queue_member_joined", v: (function() {
			var $ptr;
			return new QueueMemberJoined.ptr(0, ptrType$10.nil, "", ptrType$3.nil, "");
		}) }, { k: "queue_member_parted", v: (function() {
			var $ptr;
			return new QueueMemberParted.ptr(0, "", "");
		}) }, { k: "queue_parted", v: (function() {
			var $ptr;
			return new QueueParted.ptr(0, "", ptrType.nil);
		}) }, { k: "queue_transcripts_deleted", v: (function() {
			var $ptr;
			return new QueueTranscriptsDeleted.ptr(0, 0, 0, "");
		}) }, { k: "queue_transcripts_found", v: (function() {
			var $ptr;
			return new QueueTranscriptsFound.ptr(0, "", sliceType$2.nil);
		}) }, { k: "queue_updated", v: (function() {
			var $ptr;
			return new QueueUpdated.ptr(0, ptrType$4.nil, "", ptrType$8.nil, ptrType.nil);
		}) }, { k: "realm_deleted", v: (function() {
			var $ptr;
			return new RealmDeleted.ptr(0, "");
		}) }, { k: "realm_found", v: (function() {
			var $ptr;
			return new RealmFound.ptr(0, ptrType$2.nil, "", false);
		}) }, { k: "realm_joined", v: (function() {
			var $ptr;
			return new RealmJoined.ptr(0, ptrType$2.nil, "", false);
		}) }, { k: "realm_member_joined", v: (function() {
			var $ptr;
			return new RealmMemberJoined.ptr(0, ptrType$12.nil, ptrType$6.nil, "", ptrType$3.nil, "");
		}) }, { k: "realm_member_parted", v: (function() {
			var $ptr;
			return new RealmMemberParted.ptr(ptrType.nil, 0, ptrType.nil, "");
		}) }, { k: "realm_member_updated", v: (function() {
			var $ptr;
			return new RealmMemberUpdated.ptr(0, ptrType$12.nil, "", "");
		}) }, { k: "realm_parted", v: (function() {
			var $ptr;
			return new RealmParted.ptr(0, "");
		}) }, { k: "realm_queues_found", v: (function() {
			var $ptr;
			return new RealmQueuesFound.ptr(0, "", false);
		}) }, { k: "realm_updated", v: (function() {
			var $ptr;
			return new RealmUpdated.ptr(0, ptrType$2.nil, "");
		}) }, { k: "search_results", v: (function() {
			var $ptr;
			return new SearchResults.ptr(false, 0, false);
		}) }, { k: "session_created", v: (function() {
			var $ptr;
			return new SessionCreated.ptr(0, false, ptrType.nil, "", ptrType$13.nil, ptrType$3.nil, ptrType.nil, false, false, "", false, false, false, false, false);
		}) }, { k: "session_status_updated", v: (function() {
			var $ptr;
			return new SessionStatusUpdated.ptr(ptrType.nil, 0, "", ptrType.nil);
		}) }, { k: "transcript_contents", v: (function() {
			var $ptr;
			return new TranscriptContents.ptr(false, false, 0, ptrType.nil, sliceType$3.nil);
		}) }, { k: "transcript_deleted", v: (function() {
			var $ptr;
			return new TranscriptDeleted.ptr(sliceType.nil, 0);
		}) }, { k: "user_deleted", v: (function() {
			var $ptr;
			return new UserDeleted.ptr(0, "");
		}) }, { k: "user_found", v: (function() {
			var $ptr;
			return new UserFound.ptr(false, false, ptrType.nil, 0, false, ptrType$13.nil, ptrType$3.nil, false, false, "", false, false, false, false, false);
		}) }, { k: "user_updated", v: (function() {
			var $ptr;
			return new UserUpdated.ptr(0, false, ptrType$13.nil, ptrType$3.nil, "", false);
		}) }]);
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["math"] = (function() {
	var $pkg = {}, $init, js, arrayType, arrayType$1, arrayType$2, structType, arrayType$3, math, buf, pow10tab, init, init$1;
	js = $packages["github.com/gopherjs/gopherjs/js"];
	arrayType = $arrayType($Uint32, 2);
	arrayType$1 = $arrayType($Float32, 2);
	arrayType$2 = $arrayType($Float64, 1);
	structType = $structType([{prop: "uint32array", name: "uint32array", pkg: "math", typ: arrayType, tag: ""}, {prop: "float32array", name: "float32array", pkg: "math", typ: arrayType$1, tag: ""}, {prop: "float64array", name: "float64array", pkg: "math", typ: arrayType$2, tag: ""}]);
	arrayType$3 = $arrayType($Float64, 70);
	init = function() {
		var $ptr, ab;
		ab = new ($global.ArrayBuffer)(8);
		buf.uint32array = new ($global.Uint32Array)(ab);
		buf.float32array = new ($global.Float32Array)(ab);
		buf.float64array = new ($global.Float64Array)(ab);
	};
	init$1 = function() {
		var $ptr, _q, i, m, x;
		pow10tab[0] = 1;
		pow10tab[1] = 10;
		i = 2;
		while (true) {
			if (!(i < 70)) { break; }
			m = (_q = i / 2, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"));
			((i < 0 || i >= pow10tab.length) ? $throwRuntimeError("index out of range") : pow10tab[i] = ((m < 0 || m >= pow10tab.length) ? $throwRuntimeError("index out of range") : pow10tab[m]) * (x = i - m >> 0, ((x < 0 || x >= pow10tab.length) ? $throwRuntimeError("index out of range") : pow10tab[x])));
			i = i + (1) >> 0;
		}
	};
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = js.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		buf = new structType.ptr(arrayType.zero(), arrayType$1.zero(), arrayType$2.zero());
		pow10tab = arrayType$3.zero();
		math = $global.Math;
		init();
		init$1();
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["unicode/utf8"] = (function() {
	var $pkg = {}, $init, acceptRange, first, acceptRanges, DecodeRuneInString, RuneLen, EncodeRune;
	acceptRange = $pkg.acceptRange = $newType(0, $kindStruct, "utf8.acceptRange", "acceptRange", "unicode/utf8", function(lo_, hi_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.lo = 0;
			this.hi = 0;
			return;
		}
		this.lo = lo_;
		this.hi = hi_;
	});
	DecodeRuneInString = function(s) {
		var $ptr, _tmp, _tmp$1, _tmp$10, _tmp$11, _tmp$12, _tmp$13, _tmp$14, _tmp$15, _tmp$16, _tmp$17, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tmp$6, _tmp$7, _tmp$8, _tmp$9, accept, mask, n, r, s, s0, s1, s2, s3, size, sz, x, x$1;
		r = 0;
		size = 0;
		n = s.length;
		if (n < 1) {
			_tmp = 65533;
			_tmp$1 = 0;
			r = _tmp;
			size = _tmp$1;
			return [r, size];
		}
		s0 = s.charCodeAt(0);
		x = ((s0 < 0 || s0 >= first.length) ? $throwRuntimeError("index out of range") : first[s0]);
		if (x >= 240) {
			mask = ((x >> 0) << 31 >> 0) >> 31 >> 0;
			_tmp$2 = (((s.charCodeAt(0) >> 0) & ~mask) >> 0) | (65533 & mask);
			_tmp$3 = 1;
			r = _tmp$2;
			size = _tmp$3;
			return [r, size];
		}
		sz = (x & 7) >>> 0;
		accept = $clone((x$1 = x >>> 4 << 24 >>> 24, ((x$1 < 0 || x$1 >= acceptRanges.length) ? $throwRuntimeError("index out of range") : acceptRanges[x$1])), acceptRange);
		if (n < (sz >> 0)) {
			_tmp$4 = 65533;
			_tmp$5 = 1;
			r = _tmp$4;
			size = _tmp$5;
			return [r, size];
		}
		s1 = s.charCodeAt(1);
		if (s1 < accept.lo || accept.hi < s1) {
			_tmp$6 = 65533;
			_tmp$7 = 1;
			r = _tmp$6;
			size = _tmp$7;
			return [r, size];
		}
		if (sz === 2) {
			_tmp$8 = ((((s0 & 31) >>> 0) >> 0) << 6 >> 0) | (((s1 & 63) >>> 0) >> 0);
			_tmp$9 = 2;
			r = _tmp$8;
			size = _tmp$9;
			return [r, size];
		}
		s2 = s.charCodeAt(2);
		if (s2 < 128 || 191 < s2) {
			_tmp$10 = 65533;
			_tmp$11 = 1;
			r = _tmp$10;
			size = _tmp$11;
			return [r, size];
		}
		if (sz === 3) {
			_tmp$12 = (((((s0 & 15) >>> 0) >> 0) << 12 >> 0) | ((((s1 & 63) >>> 0) >> 0) << 6 >> 0)) | (((s2 & 63) >>> 0) >> 0);
			_tmp$13 = 3;
			r = _tmp$12;
			size = _tmp$13;
			return [r, size];
		}
		s3 = s.charCodeAt(3);
		if (s3 < 128 || 191 < s3) {
			_tmp$14 = 65533;
			_tmp$15 = 1;
			r = _tmp$14;
			size = _tmp$15;
			return [r, size];
		}
		_tmp$16 = ((((((s0 & 7) >>> 0) >> 0) << 18 >> 0) | ((((s1 & 63) >>> 0) >> 0) << 12 >> 0)) | ((((s2 & 63) >>> 0) >> 0) << 6 >> 0)) | (((s3 & 63) >>> 0) >> 0);
		_tmp$17 = 4;
		r = _tmp$16;
		size = _tmp$17;
		return [r, size];
	};
	$pkg.DecodeRuneInString = DecodeRuneInString;
	RuneLen = function(r) {
		var $ptr, r;
		if (r < 0) {
			return -1;
		} else if (r <= 127) {
			return 1;
		} else if (r <= 2047) {
			return 2;
		} else if (55296 <= r && r <= 57343) {
			return -1;
		} else if (r <= 65535) {
			return 3;
		} else if (r <= 1114111) {
			return 4;
		}
		return -1;
	};
	$pkg.RuneLen = RuneLen;
	EncodeRune = function(p, r) {
		var $ptr, i, p, r;
		i = (r >>> 0);
		if (i <= 127) {
			(0 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 0] = (r << 24 >>> 24));
			return 1;
		} else if (i <= 2047) {
			(0 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 0] = ((192 | ((r >> 6 >> 0) << 24 >>> 24)) >>> 0));
			(1 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 1] = ((128 | (((r << 24 >>> 24) & 63) >>> 0)) >>> 0));
			return 2;
		} else if ((i > 1114111) || (55296 <= i && i <= 57343)) {
			r = 65533;
			(0 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 0] = ((224 | ((r >> 12 >> 0) << 24 >>> 24)) >>> 0));
			(1 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 1] = ((128 | ((((r >> 6 >> 0) << 24 >>> 24) & 63) >>> 0)) >>> 0));
			(2 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 2] = ((128 | (((r << 24 >>> 24) & 63) >>> 0)) >>> 0));
			return 3;
		} else if (i <= 65535) {
			(0 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 0] = ((224 | ((r >> 12 >> 0) << 24 >>> 24)) >>> 0));
			(1 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 1] = ((128 | ((((r >> 6 >> 0) << 24 >>> 24) & 63) >>> 0)) >>> 0));
			(2 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 2] = ((128 | (((r << 24 >>> 24) & 63) >>> 0)) >>> 0));
			return 3;
		} else {
			(0 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 0] = ((240 | ((r >> 18 >> 0) << 24 >>> 24)) >>> 0));
			(1 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 1] = ((128 | ((((r >> 12 >> 0) << 24 >>> 24) & 63) >>> 0)) >>> 0));
			(2 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 2] = ((128 | ((((r >> 6 >> 0) << 24 >>> 24) & 63) >>> 0)) >>> 0));
			(3 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 3] = ((128 | (((r << 24 >>> 24) & 63) >>> 0)) >>> 0));
			return 4;
		}
	};
	$pkg.EncodeRune = EncodeRune;
	acceptRange.init([{prop: "lo", name: "lo", pkg: "unicode/utf8", typ: $Uint8, tag: ""}, {prop: "hi", name: "hi", pkg: "unicode/utf8", typ: $Uint8, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		first = $toNativeArray($kindUint8, [240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 19, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 35, 3, 3, 52, 4, 4, 4, 68, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241]);
		acceptRanges = $toNativeArray($kindStruct, [new acceptRange.ptr(128, 191), new acceptRange.ptr(160, 191), new acceptRange.ptr(128, 159), new acceptRange.ptr(144, 191), new acceptRange.ptr(128, 143)]);
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["strconv"] = (function() {
	var $pkg = {}, $init, errors, math, utf8, sliceType$6, arrayType$3, arrayType$4, shifts, FormatInt, Itoa, formatBits, unhex, UnquoteChar, Unquote, contains;
	errors = $packages["errors"];
	math = $packages["math"];
	utf8 = $packages["unicode/utf8"];
	sliceType$6 = $sliceType($Uint8);
	arrayType$3 = $arrayType($Uint8, 65);
	arrayType$4 = $arrayType($Uint8, 4);
	FormatInt = function(i, base) {
		var $ptr, _tuple, base, i, s;
		_tuple = formatBits(sliceType$6.nil, new $Uint64(i.$high, i.$low), base, (i.$high < 0 || (i.$high === 0 && i.$low < 0)), false);
		s = _tuple[1];
		return s;
	};
	$pkg.FormatInt = FormatInt;
	Itoa = function(i) {
		var $ptr, i;
		return FormatInt(new $Int64(0, i), 10);
	};
	$pkg.Itoa = Itoa;
	formatBits = function(dst, u, base, neg, append_) {
		var $ptr, _q, _q$1, a, append_, b, b$1, base, d, dst, i, j, m, neg, q, q$1, q$2, qs, s, s$1, u, us, us$1, x, x$1;
		d = sliceType$6.nil;
		s = "";
		if (base < 2 || base > 36) {
			$panic(new $String("strconv: illegal AppendInt/FormatInt base"));
		}
		a = arrayType$3.zero();
		i = 65;
		if (neg) {
			u = new $Uint64(-u.$high, -u.$low);
		}
		if (base === 10) {
			if (true) {
				while (true) {
					if (!((u.$high > 0 || (u.$high === 0 && u.$low > 4294967295)))) { break; }
					q = $div64(u, new $Uint64(0, 1000000000), false);
					us = ((x = $mul64(q, new $Uint64(0, 1000000000)), new $Uint64(u.$high - x.$high, u.$low - x.$low)).$low >>> 0);
					j = 9;
					while (true) {
						if (!(j > 0)) { break; }
						i = i - (1) >> 0;
						qs = (_q = us / 10, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >>> 0 : $throwRuntimeError("integer divide by zero"));
						((i < 0 || i >= a.length) ? $throwRuntimeError("index out of range") : a[i] = (((us - ($imul(qs, 10) >>> 0) >>> 0) + 48 >>> 0) << 24 >>> 24));
						us = qs;
						j = j - (1) >> 0;
					}
					u = q;
				}
			}
			us$1 = (u.$low >>> 0);
			while (true) {
				if (!(us$1 >= 10)) { break; }
				i = i - (1) >> 0;
				q$1 = (_q$1 = us$1 / 10, (_q$1 === _q$1 && _q$1 !== 1/0 && _q$1 !== -1/0) ? _q$1 >>> 0 : $throwRuntimeError("integer divide by zero"));
				((i < 0 || i >= a.length) ? $throwRuntimeError("index out of range") : a[i] = (((us$1 - ($imul(q$1, 10) >>> 0) >>> 0) + 48 >>> 0) << 24 >>> 24));
				us$1 = q$1;
			}
			i = i - (1) >> 0;
			((i < 0 || i >= a.length) ? $throwRuntimeError("index out of range") : a[i] = ((us$1 + 48 >>> 0) << 24 >>> 24));
		} else {
			s$1 = ((base < 0 || base >= shifts.length) ? $throwRuntimeError("index out of range") : shifts[base]);
			if (s$1 > 0) {
				b = new $Uint64(0, base);
				m = (b.$low >>> 0) - 1 >>> 0;
				while (true) {
					if (!((u.$high > b.$high || (u.$high === b.$high && u.$low >= b.$low)))) { break; }
					i = i - (1) >> 0;
					((i < 0 || i >= a.length) ? $throwRuntimeError("index out of range") : a[i] = "0123456789abcdefghijklmnopqrstuvwxyz".charCodeAt((((u.$low >>> 0) & m) >>> 0)));
					u = $shiftRightUint64(u, (s$1));
				}
				i = i - (1) >> 0;
				((i < 0 || i >= a.length) ? $throwRuntimeError("index out of range") : a[i] = "0123456789abcdefghijklmnopqrstuvwxyz".charCodeAt((u.$low >>> 0)));
			} else {
				b$1 = new $Uint64(0, base);
				while (true) {
					if (!((u.$high > b$1.$high || (u.$high === b$1.$high && u.$low >= b$1.$low)))) { break; }
					i = i - (1) >> 0;
					q$2 = $div64(u, b$1, false);
					((i < 0 || i >= a.length) ? $throwRuntimeError("index out of range") : a[i] = "0123456789abcdefghijklmnopqrstuvwxyz".charCodeAt(((x$1 = $mul64(q$2, b$1), new $Uint64(u.$high - x$1.$high, u.$low - x$1.$low)).$low >>> 0)));
					u = q$2;
				}
				i = i - (1) >> 0;
				((i < 0 || i >= a.length) ? $throwRuntimeError("index out of range") : a[i] = "0123456789abcdefghijklmnopqrstuvwxyz".charCodeAt((u.$low >>> 0)));
			}
		}
		if (neg) {
			i = i - (1) >> 0;
			((i < 0 || i >= a.length) ? $throwRuntimeError("index out of range") : a[i] = 45);
		}
		if (append_) {
			d = $appendSlice(dst, $subslice(new sliceType$6(a), i));
			return [d, s];
		}
		s = $bytesToString($subslice(new sliceType$6(a), i));
		return [d, s];
	};
	unhex = function(b) {
		var $ptr, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, b, c, ok, v;
		v = 0;
		ok = false;
		c = (b >> 0);
		if (48 <= c && c <= 57) {
			_tmp = c - 48 >> 0;
			_tmp$1 = true;
			v = _tmp;
			ok = _tmp$1;
			return [v, ok];
		} else if (97 <= c && c <= 102) {
			_tmp$2 = (c - 97 >> 0) + 10 >> 0;
			_tmp$3 = true;
			v = _tmp$2;
			ok = _tmp$3;
			return [v, ok];
		} else if (65 <= c && c <= 70) {
			_tmp$4 = (c - 65 >> 0) + 10 >> 0;
			_tmp$5 = true;
			v = _tmp$4;
			ok = _tmp$5;
			return [v, ok];
		}
		return [v, ok];
	};
	UnquoteChar = function(s, quote) {
		var $ptr, _2, _3, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tmp$6, _tmp$7, _tuple, _tuple$1, c, c$1, err, j, j$1, multibyte, n, ok, quote, r, s, size, tail, v, v$1, value, x, x$1;
		value = 0;
		multibyte = false;
		tail = "";
		err = $ifaceNil;
		c = s.charCodeAt(0);
		if ((c === quote) && ((quote === 39) || (quote === 34))) {
			err = $pkg.ErrSyntax;
			return [value, multibyte, tail, err];
		} else if (c >= 128) {
			_tuple = utf8.DecodeRuneInString(s);
			r = _tuple[0];
			size = _tuple[1];
			_tmp = r;
			_tmp$1 = true;
			_tmp$2 = s.substring(size);
			_tmp$3 = $ifaceNil;
			value = _tmp;
			multibyte = _tmp$1;
			tail = _tmp$2;
			err = _tmp$3;
			return [value, multibyte, tail, err];
		} else if (!((c === 92))) {
			_tmp$4 = (s.charCodeAt(0) >> 0);
			_tmp$5 = false;
			_tmp$6 = s.substring(1);
			_tmp$7 = $ifaceNil;
			value = _tmp$4;
			multibyte = _tmp$5;
			tail = _tmp$6;
			err = _tmp$7;
			return [value, multibyte, tail, err];
		}
		if (s.length <= 1) {
			err = $pkg.ErrSyntax;
			return [value, multibyte, tail, err];
		}
		c$1 = s.charCodeAt(1);
		s = s.substring(2);
		switch (0) { default:
			_2 = c$1;
			if (_2 === 97) {
				value = 7;
			} else if (_2 === 98) {
				value = 8;
			} else if (_2 === 102) {
				value = 12;
			} else if (_2 === 110) {
				value = 10;
			} else if (_2 === 114) {
				value = 13;
			} else if (_2 === 116) {
				value = 9;
			} else if (_2 === 118) {
				value = 11;
			} else if ((_2 === 120) || (_2 === 117) || (_2 === 85)) {
				n = 0;
				_3 = c$1;
				if (_3 === 120) {
					n = 2;
				} else if (_3 === 117) {
					n = 4;
				} else if (_3 === 85) {
					n = 8;
				}
				v = 0;
				if (s.length < n) {
					err = $pkg.ErrSyntax;
					return [value, multibyte, tail, err];
				}
				j = 0;
				while (true) {
					if (!(j < n)) { break; }
					_tuple$1 = unhex(s.charCodeAt(j));
					x = _tuple$1[0];
					ok = _tuple$1[1];
					if (!ok) {
						err = $pkg.ErrSyntax;
						return [value, multibyte, tail, err];
					}
					v = (v << 4 >> 0) | x;
					j = j + (1) >> 0;
				}
				s = s.substring(n);
				if (c$1 === 120) {
					value = v;
					break;
				}
				if (v > 1114111) {
					err = $pkg.ErrSyntax;
					return [value, multibyte, tail, err];
				}
				value = v;
				multibyte = true;
			} else if ((_2 === 48) || (_2 === 49) || (_2 === 50) || (_2 === 51) || (_2 === 52) || (_2 === 53) || (_2 === 54) || (_2 === 55)) {
				v$1 = (c$1 >> 0) - 48 >> 0;
				if (s.length < 2) {
					err = $pkg.ErrSyntax;
					return [value, multibyte, tail, err];
				}
				j$1 = 0;
				while (true) {
					if (!(j$1 < 2)) { break; }
					x$1 = (s.charCodeAt(j$1) >> 0) - 48 >> 0;
					if (x$1 < 0 || x$1 > 7) {
						err = $pkg.ErrSyntax;
						return [value, multibyte, tail, err];
					}
					v$1 = ((v$1 << 3 >> 0)) | x$1;
					j$1 = j$1 + (1) >> 0;
				}
				s = s.substring(2);
				if (v$1 > 255) {
					err = $pkg.ErrSyntax;
					return [value, multibyte, tail, err];
				}
				value = v$1;
			} else if (_2 === 92) {
				value = 92;
			} else if ((_2 === 39) || (_2 === 34)) {
				if (!((c$1 === quote))) {
					err = $pkg.ErrSyntax;
					return [value, multibyte, tail, err];
				}
				value = (c$1 >> 0);
			} else {
				err = $pkg.ErrSyntax;
				return [value, multibyte, tail, err];
			}
		}
		tail = s;
		return [value, multibyte, tail, err];
	};
	$pkg.UnquoteChar = UnquoteChar;
	Unquote = function(s) {
		var $ptr, _4, _q, _tmp, _tmp$1, _tmp$10, _tmp$11, _tmp$12, _tmp$13, _tmp$14, _tmp$15, _tmp$16, _tmp$17, _tmp$18, _tmp$19, _tmp$2, _tmp$20, _tmp$21, _tmp$3, _tmp$4, _tmp$5, _tmp$6, _tmp$7, _tmp$8, _tmp$9, _tuple, _tuple$1, buf, c, err, err$1, multibyte, n, n$1, quote, r, runeTmp, s, size, ss, t;
		t = "";
		err = $ifaceNil;
		n = s.length;
		if (n < 2) {
			_tmp = "";
			_tmp$1 = $pkg.ErrSyntax;
			t = _tmp;
			err = _tmp$1;
			return [t, err];
		}
		quote = s.charCodeAt(0);
		if (!((quote === s.charCodeAt((n - 1 >> 0))))) {
			_tmp$2 = "";
			_tmp$3 = $pkg.ErrSyntax;
			t = _tmp$2;
			err = _tmp$3;
			return [t, err];
		}
		s = s.substring(1, (n - 1 >> 0));
		if (quote === 96) {
			if (contains(s, 96)) {
				_tmp$4 = "";
				_tmp$5 = $pkg.ErrSyntax;
				t = _tmp$4;
				err = _tmp$5;
				return [t, err];
			}
			_tmp$6 = s;
			_tmp$7 = $ifaceNil;
			t = _tmp$6;
			err = _tmp$7;
			return [t, err];
		}
		if (!((quote === 34)) && !((quote === 39))) {
			_tmp$8 = "";
			_tmp$9 = $pkg.ErrSyntax;
			t = _tmp$8;
			err = _tmp$9;
			return [t, err];
		}
		if (contains(s, 10)) {
			_tmp$10 = "";
			_tmp$11 = $pkg.ErrSyntax;
			t = _tmp$10;
			err = _tmp$11;
			return [t, err];
		}
		if (!contains(s, 92) && !contains(s, quote)) {
			_4 = quote;
			if (_4 === 34) {
				_tmp$12 = s;
				_tmp$13 = $ifaceNil;
				t = _tmp$12;
				err = _tmp$13;
				return [t, err];
			} else if (_4 === 39) {
				_tuple = utf8.DecodeRuneInString(s);
				r = _tuple[0];
				size = _tuple[1];
				if ((size === s.length) && (!((r === 65533)) || !((size === 1)))) {
					_tmp$14 = s;
					_tmp$15 = $ifaceNil;
					t = _tmp$14;
					err = _tmp$15;
					return [t, err];
				}
			}
		}
		runeTmp = arrayType$4.zero();
		buf = $makeSlice(sliceType$6, 0, (_q = ($imul(3, s.length)) / 2, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero")));
		while (true) {
			if (!(s.length > 0)) { break; }
			_tuple$1 = UnquoteChar(s, quote);
			c = _tuple$1[0];
			multibyte = _tuple$1[1];
			ss = _tuple$1[2];
			err$1 = _tuple$1[3];
			if (!($interfaceIsEqual(err$1, $ifaceNil))) {
				_tmp$16 = "";
				_tmp$17 = err$1;
				t = _tmp$16;
				err = _tmp$17;
				return [t, err];
			}
			s = ss;
			if (c < 128 || !multibyte) {
				buf = $append(buf, (c << 24 >>> 24));
			} else {
				n$1 = utf8.EncodeRune(new sliceType$6(runeTmp), c);
				buf = $appendSlice(buf, $subslice(new sliceType$6(runeTmp), 0, n$1));
			}
			if ((quote === 39) && !((s.length === 0))) {
				_tmp$18 = "";
				_tmp$19 = $pkg.ErrSyntax;
				t = _tmp$18;
				err = _tmp$19;
				return [t, err];
			}
		}
		_tmp$20 = $bytesToString(buf);
		_tmp$21 = $ifaceNil;
		t = _tmp$20;
		err = _tmp$21;
		return [t, err];
	};
	$pkg.Unquote = Unquote;
	contains = function(s, c) {
		var $ptr, c, i, s;
		i = 0;
		while (true) {
			if (!(i < s.length)) { break; }
			if (s.charCodeAt(i) === c) {
				return true;
			}
			i = i + (1) >> 0;
		}
		return false;
	};
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = errors.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = math.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = utf8.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$pkg.ErrRange = errors.New("value out of range");
		$pkg.ErrSyntax = errors.New("invalid syntax");
		shifts = $toNativeArray($kindUint, [0, 0, 1, 0, 2, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 0, 0, 0, 0]);
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["internal/race"] = (function() {
	var $pkg = {}, $init, Acquire, Release;
	Acquire = function(addr) {
		var $ptr, addr;
	};
	$pkg.Acquire = Acquire;
	Release = function(addr) {
		var $ptr, addr;
	};
	$pkg.Release = Release;
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["sync/atomic"] = (function() {
	var $pkg = {}, $init, js, CompareAndSwapInt32, AddInt32, LoadInt32, StoreInt32;
	js = $packages["github.com/gopherjs/gopherjs/js"];
	CompareAndSwapInt32 = function(addr, old, new$1) {
		var $ptr, addr, new$1, old;
		if (addr.$get() === old) {
			addr.$set(new$1);
			return true;
		}
		return false;
	};
	$pkg.CompareAndSwapInt32 = CompareAndSwapInt32;
	AddInt32 = function(addr, delta) {
		var $ptr, addr, delta, new$1;
		new$1 = addr.$get() + delta >> 0;
		addr.$set(new$1);
		return new$1;
	};
	$pkg.AddInt32 = AddInt32;
	LoadInt32 = function(addr) {
		var $ptr, addr;
		return addr.$get();
	};
	$pkg.LoadInt32 = LoadInt32;
	StoreInt32 = function(addr, val) {
		var $ptr, addr, val;
		addr.$set(val);
	};
	$pkg.StoreInt32 = StoreInt32;
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = js.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["sync"] = (function() {
	var $pkg = {}, $init, race, runtime, atomic, Pool, Mutex, poolLocal, syncSema, ptrType, sliceType, ptrType$1, chanType, sliceType$1, ptrType$4, ptrType$6, sliceType$3, funcType, ptrType$12, arrayType$1, semWaiters, allPools, runtime_Syncsemcheck, runtime_registerPoolCleanup, runtime_Semacquire, runtime_Semrelease, runtime_canSpin, poolCleanup, init, indexLocal, init$1, runtime_doSpin;
	race = $packages["internal/race"];
	runtime = $packages["runtime"];
	atomic = $packages["sync/atomic"];
	Pool = $pkg.Pool = $newType(0, $kindStruct, "sync.Pool", "Pool", "sync", function(local_, localSize_, store_, New_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.local = 0;
			this.localSize = 0;
			this.store = sliceType$3.nil;
			this.New = $throwNilPointerError;
			return;
		}
		this.local = local_;
		this.localSize = localSize_;
		this.store = store_;
		this.New = New_;
	});
	Mutex = $pkg.Mutex = $newType(0, $kindStruct, "sync.Mutex", "Mutex", "sync", function(state_, sema_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.state = 0;
			this.sema = 0;
			return;
		}
		this.state = state_;
		this.sema = sema_;
	});
	poolLocal = $pkg.poolLocal = $newType(0, $kindStruct, "sync.poolLocal", "poolLocal", "sync", function(private$0_, shared_, Mutex_, pad_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.private$0 = $ifaceNil;
			this.shared = sliceType$3.nil;
			this.Mutex = new Mutex.ptr(0, 0);
			this.pad = arrayType$1.zero();
			return;
		}
		this.private$0 = private$0_;
		this.shared = shared_;
		this.Mutex = Mutex_;
		this.pad = pad_;
	});
	syncSema = $pkg.syncSema = $newType(0, $kindStruct, "sync.syncSema", "syncSema", "sync", function(lock_, head_, tail_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.lock = 0;
			this.head = 0;
			this.tail = 0;
			return;
		}
		this.lock = lock_;
		this.head = head_;
		this.tail = tail_;
	});
	ptrType = $ptrType(Pool);
	sliceType = $sliceType(ptrType);
	ptrType$1 = $ptrType($Uint32);
	chanType = $chanType($Bool, false, false);
	sliceType$1 = $sliceType(chanType);
	ptrType$4 = $ptrType($Int32);
	ptrType$6 = $ptrType(poolLocal);
	sliceType$3 = $sliceType($emptyInterface);
	funcType = $funcType([], [$emptyInterface], false);
	ptrType$12 = $ptrType(Mutex);
	arrayType$1 = $arrayType($Uint8, 128);
	runtime_Syncsemcheck = function(size) {
		var $ptr, size;
	};
	Pool.ptr.prototype.Get = function() {
		var $ptr, _r, p, x, x$1, x$2, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; p = $f.p; x = $f.x; x$1 = $f.x$1; x$2 = $f.x$2; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		p = this;
		/* */ if (p.store.$length === 0) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (p.store.$length === 0) { */ case 1:
			/* */ if (!(p.New === $throwNilPointerError)) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (!(p.New === $throwNilPointerError)) { */ case 3:
				_r = p.New(); /* */ $s = 5; case 5: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				/* */ $s = 6; case 6:
				return _r;
			/* } */ case 4:
			return $ifaceNil;
		/* } */ case 2:
		x$2 = (x = p.store, x$1 = p.store.$length - 1 >> 0, ((x$1 < 0 || x$1 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + x$1]));
		p.store = $subslice(p.store, 0, (p.store.$length - 1 >> 0));
		return x$2;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Pool.ptr.prototype.Get }; } $f.$ptr = $ptr; $f._r = _r; $f.p = p; $f.x = x; $f.x$1 = x$1; $f.x$2 = x$2; $f.$s = $s; $f.$r = $r; return $f;
	};
	Pool.prototype.Get = function() { return this.$val.Get(); };
	Pool.ptr.prototype.Put = function(x) {
		var $ptr, p, x;
		p = this;
		if ($interfaceIsEqual(x, $ifaceNil)) {
			return;
		}
		p.store = $append(p.store, x);
	};
	Pool.prototype.Put = function(x) { return this.$val.Put(x); };
	runtime_registerPoolCleanup = function(cleanup) {
		var $ptr, cleanup;
	};
	runtime_Semacquire = function(s) {
		var $ptr, _entry, _key, _r, ch, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _entry = $f._entry; _key = $f._key; _r = $f._r; ch = $f.ch; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		/* */ if (s.$get() === 0) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (s.$get() === 0) { */ case 1:
			ch = new $Chan($Bool, 0);
			_key = s; (semWaiters || $throwRuntimeError("assignment to entry in nil map"))[ptrType$1.keyFor(_key)] = { k: _key, v: $append((_entry = semWaiters[ptrType$1.keyFor(s)], _entry !== undefined ? _entry.v : sliceType$1.nil), ch) };
			_r = $recv(ch); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			_r[0];
		/* } */ case 2:
		s.$set(s.$get() - (1) >>> 0);
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: runtime_Semacquire }; } $f.$ptr = $ptr; $f._entry = _entry; $f._key = _key; $f._r = _r; $f.ch = ch; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	runtime_Semrelease = function(s) {
		var $ptr, _entry, _key, ch, s, w, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _entry = $f._entry; _key = $f._key; ch = $f.ch; s = $f.s; w = $f.w; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		s.$set(s.$get() + (1) >>> 0);
		w = (_entry = semWaiters[ptrType$1.keyFor(s)], _entry !== undefined ? _entry.v : sliceType$1.nil);
		if (w.$length === 0) {
			return;
		}
		ch = (0 >= w.$length ? $throwRuntimeError("index out of range") : w.$array[w.$offset + 0]);
		w = $subslice(w, 1);
		_key = s; (semWaiters || $throwRuntimeError("assignment to entry in nil map"))[ptrType$1.keyFor(_key)] = { k: _key, v: w };
		if (w.$length === 0) {
			delete semWaiters[ptrType$1.keyFor(s)];
		}
		$r = $send(ch, true); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: runtime_Semrelease }; } $f.$ptr = $ptr; $f._entry = _entry; $f._key = _key; $f.ch = ch; $f.s = s; $f.w = w; $f.$s = $s; $f.$r = $r; return $f;
	};
	runtime_canSpin = function(i) {
		var $ptr, i;
		return false;
	};
	Mutex.ptr.prototype.Lock = function() {
		var $ptr, awoke, iter, m, new$1, old, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; awoke = $f.awoke; iter = $f.iter; m = $f.m; new$1 = $f.new$1; old = $f.old; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		m = this;
		if (atomic.CompareAndSwapInt32((m.$ptr_state || (m.$ptr_state = new ptrType$4(function() { return this.$target.state; }, function($v) { this.$target.state = $v; }, m))), 0, 1)) {
			if (false) {
				race.Acquire(m);
			}
			return;
		}
		awoke = false;
		iter = 0;
		/* while (true) { */ case 1:
			old = m.state;
			new$1 = old | 1;
			/* */ if (!(((old & 1) === 0))) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (!(((old & 1) === 0))) { */ case 3:
				if (runtime_canSpin(iter)) {
					if (!awoke && ((old & 2) === 0) && !(((old >> 2 >> 0) === 0)) && atomic.CompareAndSwapInt32((m.$ptr_state || (m.$ptr_state = new ptrType$4(function() { return this.$target.state; }, function($v) { this.$target.state = $v; }, m))), old, old | 2)) {
						awoke = true;
					}
					runtime_doSpin();
					iter = iter + (1) >> 0;
					/* continue; */ $s = 1; continue;
				}
				new$1 = old + 4 >> 0;
			/* } */ case 4:
			if (awoke) {
				if ((new$1 & 2) === 0) {
					$panic(new $String("sync: inconsistent mutex state"));
				}
				new$1 = (new$1 & ~(2)) >> 0;
			}
			/* */ if (atomic.CompareAndSwapInt32((m.$ptr_state || (m.$ptr_state = new ptrType$4(function() { return this.$target.state; }, function($v) { this.$target.state = $v; }, m))), old, new$1)) { $s = 5; continue; }
			/* */ $s = 6; continue;
			/* if (atomic.CompareAndSwapInt32((m.$ptr_state || (m.$ptr_state = new ptrType$4(function() { return this.$target.state; }, function($v) { this.$target.state = $v; }, m))), old, new$1)) { */ case 5:
				if ((old & 1) === 0) {
					/* break; */ $s = 2; continue;
				}
				$r = runtime_Semacquire((m.$ptr_sema || (m.$ptr_sema = new ptrType$1(function() { return this.$target.sema; }, function($v) { this.$target.sema = $v; }, m)))); /* */ $s = 7; case 7: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				awoke = true;
				iter = 0;
			/* } */ case 6:
		/* } */ $s = 1; continue; case 2:
		if (false) {
			race.Acquire(m);
		}
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: Mutex.ptr.prototype.Lock }; } $f.$ptr = $ptr; $f.awoke = awoke; $f.iter = iter; $f.m = m; $f.new$1 = new$1; $f.old = old; $f.$s = $s; $f.$r = $r; return $f;
	};
	Mutex.prototype.Lock = function() { return this.$val.Lock(); };
	Mutex.ptr.prototype.Unlock = function() {
		var $ptr, m, new$1, old, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; m = $f.m; new$1 = $f.new$1; old = $f.old; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		m = this;
		if (false) {
			race.Release(m);
		}
		new$1 = atomic.AddInt32((m.$ptr_state || (m.$ptr_state = new ptrType$4(function() { return this.$target.state; }, function($v) { this.$target.state = $v; }, m))), -1);
		if ((((new$1 + 1 >> 0)) & 1) === 0) {
			$panic(new $String("sync: unlock of unlocked mutex"));
		}
		old = new$1;
		/* while (true) { */ case 1:
			if (((old >> 2 >> 0) === 0) || !(((old & 3) === 0))) {
				return;
			}
			new$1 = ((old - 4 >> 0)) | 2;
			/* */ if (atomic.CompareAndSwapInt32((m.$ptr_state || (m.$ptr_state = new ptrType$4(function() { return this.$target.state; }, function($v) { this.$target.state = $v; }, m))), old, new$1)) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (atomic.CompareAndSwapInt32((m.$ptr_state || (m.$ptr_state = new ptrType$4(function() { return this.$target.state; }, function($v) { this.$target.state = $v; }, m))), old, new$1)) { */ case 3:
				$r = runtime_Semrelease((m.$ptr_sema || (m.$ptr_sema = new ptrType$1(function() { return this.$target.sema; }, function($v) { this.$target.sema = $v; }, m)))); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				return;
			/* } */ case 4:
			old = m.state;
		/* } */ $s = 1; continue; case 2:
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: Mutex.ptr.prototype.Unlock }; } $f.$ptr = $ptr; $f.m = m; $f.new$1 = new$1; $f.old = old; $f.$s = $s; $f.$r = $r; return $f;
	};
	Mutex.prototype.Unlock = function() { return this.$val.Unlock(); };
	poolCleanup = function() {
		var $ptr, _i, _i$1, _ref, _ref$1, i, i$1, j, l, p, x;
		_ref = allPools;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			i = _i;
			p = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			((i < 0 || i >= allPools.$length) ? $throwRuntimeError("index out of range") : allPools.$array[allPools.$offset + i] = ptrType.nil);
			i$1 = 0;
			while (true) {
				if (!(i$1 < (p.localSize >> 0))) { break; }
				l = indexLocal(p.local, i$1);
				l.private$0 = $ifaceNil;
				_ref$1 = l.shared;
				_i$1 = 0;
				while (true) {
					if (!(_i$1 < _ref$1.$length)) { break; }
					j = _i$1;
					(x = l.shared, ((j < 0 || j >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + j] = $ifaceNil));
					_i$1++;
				}
				l.shared = sliceType$3.nil;
				i$1 = i$1 + (1) >> 0;
			}
			p.local = 0;
			p.localSize = 0;
			_i++;
		}
		allPools = new sliceType([]);
	};
	init = function() {
		var $ptr;
		runtime_registerPoolCleanup(poolCleanup);
	};
	indexLocal = function(l, i) {
		var $ptr, i, l, x;
		return (x = l, (x.nilCheck, ((i < 0 || i >= x.length) ? $throwRuntimeError("index out of range") : x[i])));
	};
	init$1 = function() {
		var $ptr, s;
		s = new syncSema.ptr(0, 0, 0);
		runtime_Syncsemcheck(12);
	};
	runtime_doSpin = function() {
		$throwRuntimeError("native function not implemented: sync.runtime_doSpin");
	};
	ptrType.methods = [{prop: "Get", name: "Get", pkg: "", typ: $funcType([], [$emptyInterface], false)}, {prop: "Put", name: "Put", pkg: "", typ: $funcType([$emptyInterface], [], false)}, {prop: "getSlow", name: "getSlow", pkg: "sync", typ: $funcType([], [$emptyInterface], false)}, {prop: "pin", name: "pin", pkg: "sync", typ: $funcType([], [ptrType$6], false)}, {prop: "pinSlow", name: "pinSlow", pkg: "sync", typ: $funcType([], [ptrType$6], false)}];
	ptrType$12.methods = [{prop: "Lock", name: "Lock", pkg: "", typ: $funcType([], [], false)}, {prop: "Unlock", name: "Unlock", pkg: "", typ: $funcType([], [], false)}];
	Pool.init([{prop: "local", name: "local", pkg: "sync", typ: $UnsafePointer, tag: ""}, {prop: "localSize", name: "localSize", pkg: "sync", typ: $Uintptr, tag: ""}, {prop: "store", name: "store", pkg: "sync", typ: sliceType$3, tag: ""}, {prop: "New", name: "New", pkg: "", typ: funcType, tag: ""}]);
	Mutex.init([{prop: "state", name: "state", pkg: "sync", typ: $Int32, tag: ""}, {prop: "sema", name: "sema", pkg: "sync", typ: $Uint32, tag: ""}]);
	poolLocal.init([{prop: "private$0", name: "private", pkg: "sync", typ: $emptyInterface, tag: ""}, {prop: "shared", name: "shared", pkg: "sync", typ: sliceType$3, tag: ""}, {prop: "Mutex", name: "", pkg: "", typ: Mutex, tag: ""}, {prop: "pad", name: "pad", pkg: "sync", typ: arrayType$1, tag: ""}]);
	syncSema.init([{prop: "lock", name: "lock", pkg: "sync", typ: $Uintptr, tag: ""}, {prop: "head", name: "head", pkg: "sync", typ: $UnsafePointer, tag: ""}, {prop: "tail", name: "tail", pkg: "sync", typ: $UnsafePointer, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = race.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = runtime.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = atomic.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		allPools = sliceType.nil;
		semWaiters = {};
		init();
		init$1();
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["reflect"] = (function() {
	var $pkg = {}, $init, errors, js, math, runtime, strconv, sync, mapIter, Type, Kind, rtype, typeAlg, method, uncommonType, ChanDir, arrayType, chanType, funcType, imethod, interfaceType, mapType, ptrType, sliceType, structField, structType, Method, StructField, StructTag, fieldScan, Value, flag, ValueError, nonEmptyInterface, ptrType$1, sliceType$1, sliceType$2, ptrType$3, funcType$1, sliceType$3, ptrType$4, ptrType$5, ptrType$6, ptrType$7, sliceType$4, sliceType$5, sliceType$6, structType$6, sliceType$7, sliceType$8, ptrType$8, arrayType$1, structType$7, ptrType$9, sliceType$9, arrayType$2, sliceType$10, ptrType$10, ptrType$11, ptrType$12, sliceType$11, sliceType$12, ptrType$13, sliceType$13, ptrType$18, sliceType$15, funcType$3, funcType$4, funcType$5, arrayType$3, ptrType$20, initialized, stringPtrMap, callHelper, jsObjectPtr, selectHelper, kindNames, uint8Type, init, jsType, reflectType, setKindType, newStringPtr, isWrapped, copyStruct, makeValue, MakeSlice, TypeOf, ValueOf, SliceOf, Zero, unsafe_New, makeInt, typedmemmove, keyFor, mapaccess, mapassign, mapdelete, mapiterinit, mapiterkey, mapiternext, maplen, cvtDirect, methodReceiver, valueInterface, ifaceE2I, methodName, makeMethodValue, wrapJsObject, unwrapJsObject, getJsTag, chanrecv, chansend, DeepEqual, deepValueEqualJs, PtrTo, implements$1, directlyAssignable, haveIdenticalUnderlyingType, toType, ifaceIndir, overflowFloat32, New, convertOp, makeFloat, makeComplex, makeString, makeBytes, makeRunes, cvtInt, cvtUint, cvtFloatInt, cvtFloatUint, cvtIntFloat, cvtUintFloat, cvtFloat, cvtComplex, cvtIntString, cvtUintString, cvtBytesString, cvtStringBytes, cvtRunesString, cvtStringRunes, cvtT2I, cvtI2I;
	errors = $packages["errors"];
	js = $packages["github.com/gopherjs/gopherjs/js"];
	math = $packages["math"];
	runtime = $packages["runtime"];
	strconv = $packages["strconv"];
	sync = $packages["sync"];
	mapIter = $pkg.mapIter = $newType(0, $kindStruct, "reflect.mapIter", "mapIter", "reflect", function(t_, m_, keys_, i_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.t = $ifaceNil;
			this.m = null;
			this.keys = null;
			this.i = 0;
			return;
		}
		this.t = t_;
		this.m = m_;
		this.keys = keys_;
		this.i = i_;
	});
	Type = $pkg.Type = $newType(8, $kindInterface, "reflect.Type", "Type", "reflect", null);
	Kind = $pkg.Kind = $newType(4, $kindUint, "reflect.Kind", "Kind", "reflect", null);
	rtype = $pkg.rtype = $newType(0, $kindStruct, "reflect.rtype", "rtype", "reflect", function(size_, ptrdata_, hash_, _$3_, align_, fieldAlign_, kind_, alg_, gcdata_, string_, uncommonType_, ptrToThis_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.size = 0;
			this.ptrdata = 0;
			this.hash = 0;
			this._$3 = 0;
			this.align = 0;
			this.fieldAlign = 0;
			this.kind = 0;
			this.alg = ptrType$4.nil;
			this.gcdata = ptrType$5.nil;
			this.string = ptrType$6.nil;
			this.uncommonType = ptrType$7.nil;
			this.ptrToThis = ptrType$1.nil;
			return;
		}
		this.size = size_;
		this.ptrdata = ptrdata_;
		this.hash = hash_;
		this._$3 = _$3_;
		this.align = align_;
		this.fieldAlign = fieldAlign_;
		this.kind = kind_;
		this.alg = alg_;
		this.gcdata = gcdata_;
		this.string = string_;
		this.uncommonType = uncommonType_;
		this.ptrToThis = ptrToThis_;
	});
	typeAlg = $pkg.typeAlg = $newType(0, $kindStruct, "reflect.typeAlg", "typeAlg", "reflect", function(hash_, equal_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.hash = $throwNilPointerError;
			this.equal = $throwNilPointerError;
			return;
		}
		this.hash = hash_;
		this.equal = equal_;
	});
	method = $pkg.method = $newType(0, $kindStruct, "reflect.method", "method", "reflect", function(name_, pkgPath_, mtyp_, typ_, ifn_, tfn_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.name = ptrType$6.nil;
			this.pkgPath = ptrType$6.nil;
			this.mtyp = ptrType$1.nil;
			this.typ = ptrType$1.nil;
			this.ifn = 0;
			this.tfn = 0;
			return;
		}
		this.name = name_;
		this.pkgPath = pkgPath_;
		this.mtyp = mtyp_;
		this.typ = typ_;
		this.ifn = ifn_;
		this.tfn = tfn_;
	});
	uncommonType = $pkg.uncommonType = $newType(0, $kindStruct, "reflect.uncommonType", "uncommonType", "reflect", function(name_, pkgPath_, methods_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.name = ptrType$6.nil;
			this.pkgPath = ptrType$6.nil;
			this.methods = sliceType$4.nil;
			return;
		}
		this.name = name_;
		this.pkgPath = pkgPath_;
		this.methods = methods_;
	});
	ChanDir = $pkg.ChanDir = $newType(4, $kindInt, "reflect.ChanDir", "ChanDir", "reflect", null);
	arrayType = $pkg.arrayType = $newType(0, $kindStruct, "reflect.arrayType", "arrayType", "reflect", function(rtype_, elem_, slice_, len_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.rtype = new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, ptrType$6.nil, ptrType$7.nil, ptrType$1.nil);
			this.elem = ptrType$1.nil;
			this.slice = ptrType$1.nil;
			this.len = 0;
			return;
		}
		this.rtype = rtype_;
		this.elem = elem_;
		this.slice = slice_;
		this.len = len_;
	});
	chanType = $pkg.chanType = $newType(0, $kindStruct, "reflect.chanType", "chanType", "reflect", function(rtype_, elem_, dir_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.rtype = new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, ptrType$6.nil, ptrType$7.nil, ptrType$1.nil);
			this.elem = ptrType$1.nil;
			this.dir = 0;
			return;
		}
		this.rtype = rtype_;
		this.elem = elem_;
		this.dir = dir_;
	});
	funcType = $pkg.funcType = $newType(0, $kindStruct, "reflect.funcType", "funcType", "reflect", function(rtype_, dotdotdot_, in$2_, out_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.rtype = new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, ptrType$6.nil, ptrType$7.nil, ptrType$1.nil);
			this.dotdotdot = false;
			this.in$2 = sliceType$1.nil;
			this.out = sliceType$1.nil;
			return;
		}
		this.rtype = rtype_;
		this.dotdotdot = dotdotdot_;
		this.in$2 = in$2_;
		this.out = out_;
	});
	imethod = $pkg.imethod = $newType(0, $kindStruct, "reflect.imethod", "imethod", "reflect", function(name_, pkgPath_, typ_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.name = ptrType$6.nil;
			this.pkgPath = ptrType$6.nil;
			this.typ = ptrType$1.nil;
			return;
		}
		this.name = name_;
		this.pkgPath = pkgPath_;
		this.typ = typ_;
	});
	interfaceType = $pkg.interfaceType = $newType(0, $kindStruct, "reflect.interfaceType", "interfaceType", "reflect", function(rtype_, methods_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.rtype = new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, ptrType$6.nil, ptrType$7.nil, ptrType$1.nil);
			this.methods = sliceType$5.nil;
			return;
		}
		this.rtype = rtype_;
		this.methods = methods_;
	});
	mapType = $pkg.mapType = $newType(0, $kindStruct, "reflect.mapType", "mapType", "reflect", function(rtype_, key_, elem_, bucket_, hmap_, keysize_, indirectkey_, valuesize_, indirectvalue_, bucketsize_, reflexivekey_, needkeyupdate_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.rtype = new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, ptrType$6.nil, ptrType$7.nil, ptrType$1.nil);
			this.key = ptrType$1.nil;
			this.elem = ptrType$1.nil;
			this.bucket = ptrType$1.nil;
			this.hmap = ptrType$1.nil;
			this.keysize = 0;
			this.indirectkey = 0;
			this.valuesize = 0;
			this.indirectvalue = 0;
			this.bucketsize = 0;
			this.reflexivekey = false;
			this.needkeyupdate = false;
			return;
		}
		this.rtype = rtype_;
		this.key = key_;
		this.elem = elem_;
		this.bucket = bucket_;
		this.hmap = hmap_;
		this.keysize = keysize_;
		this.indirectkey = indirectkey_;
		this.valuesize = valuesize_;
		this.indirectvalue = indirectvalue_;
		this.bucketsize = bucketsize_;
		this.reflexivekey = reflexivekey_;
		this.needkeyupdate = needkeyupdate_;
	});
	ptrType = $pkg.ptrType = $newType(0, $kindStruct, "reflect.ptrType", "ptrType", "reflect", function(rtype_, elem_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.rtype = new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, ptrType$6.nil, ptrType$7.nil, ptrType$1.nil);
			this.elem = ptrType$1.nil;
			return;
		}
		this.rtype = rtype_;
		this.elem = elem_;
	});
	sliceType = $pkg.sliceType = $newType(0, $kindStruct, "reflect.sliceType", "sliceType", "reflect", function(rtype_, elem_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.rtype = new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, ptrType$6.nil, ptrType$7.nil, ptrType$1.nil);
			this.elem = ptrType$1.nil;
			return;
		}
		this.rtype = rtype_;
		this.elem = elem_;
	});
	structField = $pkg.structField = $newType(0, $kindStruct, "reflect.structField", "structField", "reflect", function(name_, pkgPath_, typ_, tag_, offset_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.name = ptrType$6.nil;
			this.pkgPath = ptrType$6.nil;
			this.typ = ptrType$1.nil;
			this.tag = ptrType$6.nil;
			this.offset = 0;
			return;
		}
		this.name = name_;
		this.pkgPath = pkgPath_;
		this.typ = typ_;
		this.tag = tag_;
		this.offset = offset_;
	});
	structType = $pkg.structType = $newType(0, $kindStruct, "reflect.structType", "structType", "reflect", function(rtype_, fields_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.rtype = new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, ptrType$6.nil, ptrType$7.nil, ptrType$1.nil);
			this.fields = sliceType$6.nil;
			return;
		}
		this.rtype = rtype_;
		this.fields = fields_;
	});
	Method = $pkg.Method = $newType(0, $kindStruct, "reflect.Method", "Method", "reflect", function(Name_, PkgPath_, Type_, Func_, Index_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Name = "";
			this.PkgPath = "";
			this.Type = $ifaceNil;
			this.Func = new Value.ptr(ptrType$1.nil, 0, 0);
			this.Index = 0;
			return;
		}
		this.Name = Name_;
		this.PkgPath = PkgPath_;
		this.Type = Type_;
		this.Func = Func_;
		this.Index = Index_;
	});
	StructField = $pkg.StructField = $newType(0, $kindStruct, "reflect.StructField", "StructField", "reflect", function(Name_, PkgPath_, Type_, Tag_, Offset_, Index_, Anonymous_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Name = "";
			this.PkgPath = "";
			this.Type = $ifaceNil;
			this.Tag = "";
			this.Offset = 0;
			this.Index = sliceType$11.nil;
			this.Anonymous = false;
			return;
		}
		this.Name = Name_;
		this.PkgPath = PkgPath_;
		this.Type = Type_;
		this.Tag = Tag_;
		this.Offset = Offset_;
		this.Index = Index_;
		this.Anonymous = Anonymous_;
	});
	StructTag = $pkg.StructTag = $newType(8, $kindString, "reflect.StructTag", "StructTag", "reflect", null);
	fieldScan = $pkg.fieldScan = $newType(0, $kindStruct, "reflect.fieldScan", "fieldScan", "reflect", function(typ_, index_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.typ = ptrType$13.nil;
			this.index = sliceType$11.nil;
			return;
		}
		this.typ = typ_;
		this.index = index_;
	});
	Value = $pkg.Value = $newType(0, $kindStruct, "reflect.Value", "Value", "reflect", function(typ_, ptr_, flag_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.typ = ptrType$1.nil;
			this.ptr = 0;
			this.flag = 0;
			return;
		}
		this.typ = typ_;
		this.ptr = ptr_;
		this.flag = flag_;
	});
	flag = $pkg.flag = $newType(4, $kindUintptr, "reflect.flag", "flag", "reflect", null);
	ValueError = $pkg.ValueError = $newType(0, $kindStruct, "reflect.ValueError", "ValueError", "reflect", function(Method_, Kind_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Method = "";
			this.Kind = 0;
			return;
		}
		this.Method = Method_;
		this.Kind = Kind_;
	});
	nonEmptyInterface = $pkg.nonEmptyInterface = $newType(0, $kindStruct, "reflect.nonEmptyInterface", "nonEmptyInterface", "reflect", function(itab_, word_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.itab = ptrType$9.nil;
			this.word = 0;
			return;
		}
		this.itab = itab_;
		this.word = word_;
	});
	ptrType$1 = $ptrType(rtype);
	sliceType$1 = $sliceType(ptrType$1);
	sliceType$2 = $sliceType($emptyInterface);
	ptrType$3 = $ptrType(js.Object);
	funcType$1 = $funcType([sliceType$2], [ptrType$3], true);
	sliceType$3 = $sliceType($String);
	ptrType$4 = $ptrType(typeAlg);
	ptrType$5 = $ptrType($Uint8);
	ptrType$6 = $ptrType($String);
	ptrType$7 = $ptrType(uncommonType);
	sliceType$4 = $sliceType(method);
	sliceType$5 = $sliceType(imethod);
	sliceType$6 = $sliceType(structField);
	structType$6 = $structType([{prop: "str", name: "str", pkg: "reflect", typ: $String, tag: ""}]);
	sliceType$7 = $sliceType(ptrType$3);
	sliceType$8 = $sliceType(Value);
	ptrType$8 = $ptrType(nonEmptyInterface);
	arrayType$1 = $arrayType($UnsafePointer, 100000);
	structType$7 = $structType([{prop: "ityp", name: "ityp", pkg: "reflect", typ: ptrType$1, tag: ""}, {prop: "typ", name: "typ", pkg: "reflect", typ: ptrType$1, tag: ""}, {prop: "link", name: "link", pkg: "reflect", typ: $UnsafePointer, tag: ""}, {prop: "bad", name: "bad", pkg: "reflect", typ: $Int32, tag: ""}, {prop: "unused", name: "unused", pkg: "reflect", typ: $Int32, tag: ""}, {prop: "fun", name: "fun", pkg: "reflect", typ: arrayType$1, tag: ""}]);
	ptrType$9 = $ptrType(structType$7);
	sliceType$9 = $sliceType(sliceType$7);
	arrayType$2 = $arrayType($UnsafePointer, 2);
	sliceType$10 = $sliceType(arrayType$2);
	ptrType$10 = $ptrType(method);
	ptrType$11 = $ptrType(interfaceType);
	ptrType$12 = $ptrType(imethod);
	sliceType$11 = $sliceType($Int);
	sliceType$12 = $sliceType(fieldScan);
	ptrType$13 = $ptrType(structType);
	sliceType$13 = $sliceType($Uint8);
	ptrType$18 = $ptrType($UnsafePointer);
	sliceType$15 = $sliceType($Int32);
	funcType$3 = $funcType([$String], [$Bool], false);
	funcType$4 = $funcType([$UnsafePointer, $Uintptr], [$Uintptr], false);
	funcType$5 = $funcType([$UnsafePointer, $UnsafePointer], [$Bool], false);
	arrayType$3 = $arrayType($Uintptr, 2);
	ptrType$20 = $ptrType(ValueError);
	init = function() {
		var $ptr, used, x, x$1, x$10, x$11, x$12, x$2, x$3, x$4, x$5, x$6, x$7, x$8, x$9, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; used = $f.used; x = $f.x; x$1 = $f.x$1; x$10 = $f.x$10; x$11 = $f.x$11; x$12 = $f.x$12; x$2 = $f.x$2; x$3 = $f.x$3; x$4 = $f.x$4; x$5 = $f.x$5; x$6 = $f.x$6; x$7 = $f.x$7; x$8 = $f.x$8; x$9 = $f.x$9; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		used = (function(i) {
			var $ptr, i;
		});
		$r = used((x = new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, ptrType$6.nil, ptrType$7.nil, ptrType$1.nil), new x.constructor.elem(x))); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = used((x$1 = new uncommonType.ptr(ptrType$6.nil, ptrType$6.nil, sliceType$4.nil), new x$1.constructor.elem(x$1))); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = used((x$2 = new method.ptr(ptrType$6.nil, ptrType$6.nil, ptrType$1.nil, ptrType$1.nil, 0, 0), new x$2.constructor.elem(x$2))); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = used((x$3 = new arrayType.ptr(new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, ptrType$6.nil, ptrType$7.nil, ptrType$1.nil), ptrType$1.nil, ptrType$1.nil, 0), new x$3.constructor.elem(x$3))); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = used((x$4 = new chanType.ptr(new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, ptrType$6.nil, ptrType$7.nil, ptrType$1.nil), ptrType$1.nil, 0), new x$4.constructor.elem(x$4))); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = used((x$5 = new funcType.ptr(new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, ptrType$6.nil, ptrType$7.nil, ptrType$1.nil), false, sliceType$1.nil, sliceType$1.nil), new x$5.constructor.elem(x$5))); /* */ $s = 6; case 6: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = used((x$6 = new interfaceType.ptr(new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, ptrType$6.nil, ptrType$7.nil, ptrType$1.nil), sliceType$5.nil), new x$6.constructor.elem(x$6))); /* */ $s = 7; case 7: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = used((x$7 = new mapType.ptr(new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, ptrType$6.nil, ptrType$7.nil, ptrType$1.nil), ptrType$1.nil, ptrType$1.nil, ptrType$1.nil, ptrType$1.nil, 0, 0, 0, 0, 0, false, false), new x$7.constructor.elem(x$7))); /* */ $s = 8; case 8: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = used((x$8 = new ptrType.ptr(new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, ptrType$6.nil, ptrType$7.nil, ptrType$1.nil), ptrType$1.nil), new x$8.constructor.elem(x$8))); /* */ $s = 9; case 9: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = used((x$9 = new sliceType.ptr(new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, ptrType$6.nil, ptrType$7.nil, ptrType$1.nil), ptrType$1.nil), new x$9.constructor.elem(x$9))); /* */ $s = 10; case 10: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = used((x$10 = new structType.ptr(new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, ptrType$6.nil, ptrType$7.nil, ptrType$1.nil), sliceType$6.nil), new x$10.constructor.elem(x$10))); /* */ $s = 11; case 11: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = used((x$11 = new imethod.ptr(ptrType$6.nil, ptrType$6.nil, ptrType$1.nil), new x$11.constructor.elem(x$11))); /* */ $s = 12; case 12: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = used((x$12 = new structField.ptr(ptrType$6.nil, ptrType$6.nil, ptrType$1.nil, ptrType$6.nil, 0), new x$12.constructor.elem(x$12))); /* */ $s = 13; case 13: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		initialized = true;
		uint8Type = $assertType(TypeOf(new $Uint8(0)), ptrType$1);
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: init }; } $f.$ptr = $ptr; $f.used = used; $f.x = x; $f.x$1 = x$1; $f.x$10 = x$10; $f.x$11 = x$11; $f.x$12 = x$12; $f.x$2 = x$2; $f.x$3 = x$3; $f.x$4 = x$4; $f.x$5 = x$5; $f.x$6 = x$6; $f.x$7 = x$7; $f.x$8 = x$8; $f.x$9 = x$9; $f.$s = $s; $f.$r = $r; return $f;
	};
	jsType = function(typ) {
		var $ptr, typ;
		return typ.jsType;
	};
	reflectType = function(typ) {
		var $ptr, _1, _i, _i$1, _i$2, _i$3, _i$4, _ref, _ref$1, _ref$2, _ref$3, _ref$4, dir, f, fields, i, i$1, i$2, i$3, i$4, imethods, in$1, m, m$1, methodSet, methods, out, params, reflectFields, reflectMethods, results, rt, t, typ;
		if (typ.reflectType === undefined) {
			rt = new rtype.ptr((($parseInt(typ.size) >> 0) >>> 0), 0, 0, 0, 0, 0, (($parseInt(typ.kind) >> 0) << 24 >>> 24), ptrType$4.nil, ptrType$5.nil, newStringPtr(typ.string), ptrType$7.nil, ptrType$1.nil);
			rt.jsType = typ;
			typ.reflectType = rt;
			methodSet = $methodSet(typ);
			if (!($internalize(typ.typeName, $String) === "") || !(($parseInt(methodSet.length) === 0))) {
				reflectMethods = $makeSlice(sliceType$4, $parseInt(methodSet.length));
				_ref = reflectMethods;
				_i = 0;
				while (true) {
					if (!(_i < _ref.$length)) { break; }
					i = _i;
					m = methodSet[i];
					t = m.typ;
					method.copy(((i < 0 || i >= reflectMethods.$length) ? $throwRuntimeError("index out of range") : reflectMethods.$array[reflectMethods.$offset + i]), new method.ptr(newStringPtr(m.name), newStringPtr(m.pkg), reflectType(t), reflectType($funcType(new ($global.Array)(typ).concat(t.params), t.results, t.variadic)), 0, 0));
					_i++;
				}
				rt.uncommonType = new uncommonType.ptr(newStringPtr(typ.typeName), newStringPtr(typ.pkg), reflectMethods);
				rt.uncommonType.jsType = typ;
			}
			_1 = rt.Kind();
			if (_1 === 17) {
				setKindType(rt, new arrayType.ptr(new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, ptrType$6.nil, ptrType$7.nil, ptrType$1.nil), reflectType(typ.elem), ptrType$1.nil, (($parseInt(typ.len) >> 0) >>> 0)));
			} else if (_1 === 18) {
				dir = 3;
				if (!!(typ.sendOnly)) {
					dir = 2;
				}
				if (!!(typ.recvOnly)) {
					dir = 1;
				}
				setKindType(rt, new chanType.ptr(new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, ptrType$6.nil, ptrType$7.nil, ptrType$1.nil), reflectType(typ.elem), (dir >>> 0)));
			} else if (_1 === 19) {
				params = typ.params;
				in$1 = $makeSlice(sliceType$1, $parseInt(params.length));
				_ref$1 = in$1;
				_i$1 = 0;
				while (true) {
					if (!(_i$1 < _ref$1.$length)) { break; }
					i$1 = _i$1;
					((i$1 < 0 || i$1 >= in$1.$length) ? $throwRuntimeError("index out of range") : in$1.$array[in$1.$offset + i$1] = reflectType(params[i$1]));
					_i$1++;
				}
				results = typ.results;
				out = $makeSlice(sliceType$1, $parseInt(results.length));
				_ref$2 = out;
				_i$2 = 0;
				while (true) {
					if (!(_i$2 < _ref$2.$length)) { break; }
					i$2 = _i$2;
					((i$2 < 0 || i$2 >= out.$length) ? $throwRuntimeError("index out of range") : out.$array[out.$offset + i$2] = reflectType(results[i$2]));
					_i$2++;
				}
				setKindType(rt, new funcType.ptr($clone(rt, rtype), !!(typ.variadic), in$1, out));
			} else if (_1 === 20) {
				methods = typ.methods;
				imethods = $makeSlice(sliceType$5, $parseInt(methods.length));
				_ref$3 = imethods;
				_i$3 = 0;
				while (true) {
					if (!(_i$3 < _ref$3.$length)) { break; }
					i$3 = _i$3;
					m$1 = methods[i$3];
					imethod.copy(((i$3 < 0 || i$3 >= imethods.$length) ? $throwRuntimeError("index out of range") : imethods.$array[imethods.$offset + i$3]), new imethod.ptr(newStringPtr(m$1.name), newStringPtr(m$1.pkg), reflectType(m$1.typ)));
					_i$3++;
				}
				setKindType(rt, new interfaceType.ptr($clone(rt, rtype), imethods));
			} else if (_1 === 21) {
				setKindType(rt, new mapType.ptr(new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, ptrType$6.nil, ptrType$7.nil, ptrType$1.nil), reflectType(typ.key), reflectType(typ.elem), ptrType$1.nil, ptrType$1.nil, 0, 0, 0, 0, 0, false, false));
			} else if (_1 === 22) {
				setKindType(rt, new ptrType.ptr(new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, ptrType$6.nil, ptrType$7.nil, ptrType$1.nil), reflectType(typ.elem)));
			} else if (_1 === 23) {
				setKindType(rt, new sliceType.ptr(new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, ptrType$6.nil, ptrType$7.nil, ptrType$1.nil), reflectType(typ.elem)));
			} else if (_1 === 25) {
				fields = typ.fields;
				reflectFields = $makeSlice(sliceType$6, $parseInt(fields.length));
				_ref$4 = reflectFields;
				_i$4 = 0;
				while (true) {
					if (!(_i$4 < _ref$4.$length)) { break; }
					i$4 = _i$4;
					f = fields[i$4];
					structField.copy(((i$4 < 0 || i$4 >= reflectFields.$length) ? $throwRuntimeError("index out of range") : reflectFields.$array[reflectFields.$offset + i$4]), new structField.ptr(newStringPtr(f.name), newStringPtr(f.pkg), reflectType(f.typ), newStringPtr(f.tag), (i$4 >>> 0)));
					_i$4++;
				}
				setKindType(rt, new structType.ptr($clone(rt, rtype), reflectFields));
			}
		}
		return typ.reflectType;
	};
	setKindType = function(rt, kindType) {
		var $ptr, kindType, rt;
		rt.kindType = kindType;
		kindType.rtype = rt;
	};
	newStringPtr = function(strObj) {
		var $ptr, _entry, _key, _tuple, c, ok, ptr, str, str$24ptr, strObj;
		c = new structType$6.ptr("");
		c.str = strObj;
		str = c.str;
		if (str === "") {
			return ptrType$6.nil;
		}
		_tuple = (_entry = stringPtrMap[$String.keyFor(str)], _entry !== undefined ? [_entry.v, true] : [ptrType$6.nil, false]);
		ptr = _tuple[0];
		ok = _tuple[1];
		if (!ok) {
			ptr = (str$24ptr || (str$24ptr = new ptrType$6(function() { return str; }, function($v) { str = $v; })));
			_key = str; (stringPtrMap || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key)] = { k: _key, v: ptr };
		}
		return ptr;
	};
	isWrapped = function(typ) {
		var $ptr, typ;
		return !!(jsType(typ).wrapped);
	};
	copyStruct = function(dst, src, typ) {
		var $ptr, dst, fields, i, prop, src, typ;
		fields = jsType(typ).fields;
		i = 0;
		while (true) {
			if (!(i < $parseInt(fields.length))) { break; }
			prop = $internalize(fields[i].prop, $String);
			dst[$externalize(prop, $String)] = src[$externalize(prop, $String)];
			i = i + (1) >> 0;
		}
	};
	makeValue = function(t, v, fl) {
		var $ptr, _r, _r$1, _r$2, _r$3, _r$4, _r$5, _v, _v$1, fl, rt, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; _r$5 = $f._r$5; _v = $f._v; _v$1 = $f._v$1; fl = $f.fl; rt = $f.rt; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = t.common(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		rt = _r;
		_r$1 = t.Kind(); /* */ $s = 6; case 6: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		if (_r$1 === 17) { _v$1 = true; $s = 5; continue s; }
		_r$2 = t.Kind(); /* */ $s = 7; case 7: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		_v$1 = _r$2 === 25; case 5:
		if (_v$1) { _v = true; $s = 4; continue s; }
		_r$3 = t.Kind(); /* */ $s = 8; case 8: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
		_v = _r$3 === 22; case 4:
		/* */ if (_v) { $s = 2; continue; }
		/* */ $s = 3; continue;
		/* if (_v) { */ case 2:
			_r$4 = t.Kind(); /* */ $s = 9; case 9: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
			/* */ $s = 10; case 10:
			return new Value.ptr(rt, v, (fl | (_r$4 >>> 0)) >>> 0);
		/* } */ case 3:
		_r$5 = t.Kind(); /* */ $s = 11; case 11: if($c) { $c = false; _r$5 = _r$5.$blk(); } if (_r$5 && _r$5.$blk !== undefined) { break s; }
		/* */ $s = 12; case 12:
		return new Value.ptr(rt, $newDataPointer(v, jsType(rt.ptrTo())), (((fl | (_r$5 >>> 0)) >>> 0) | 128) >>> 0);
		/* */ } return; } if ($f === undefined) { $f = { $blk: makeValue }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._r$5 = _r$5; $f._v = _v; $f._v$1 = _v$1; $f.fl = fl; $f.rt = rt; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	MakeSlice = function(typ, len, cap) {
		var $ptr, _r, _r$1, cap, len, typ, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; cap = $f.cap; len = $f.len; typ = $f.typ; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		typ = [typ];
		_r = typ[0].Kind(); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ if (!((_r === 23))) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!((_r === 23))) { */ case 1:
			$panic(new $String("reflect.MakeSlice of non-slice type"));
		/* } */ case 2:
		if (len < 0) {
			$panic(new $String("reflect.MakeSlice: negative len"));
		}
		if (cap < 0) {
			$panic(new $String("reflect.MakeSlice: negative cap"));
		}
		if (len > cap) {
			$panic(new $String("reflect.MakeSlice: len > cap"));
		}
		_r$1 = makeValue(typ[0], $makeSlice(jsType(typ[0]), len, cap, (function(typ) { return function $b() {
			var $ptr, _r$1, _r$2, $s, $r;
			/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _r$2 = $f._r$2; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
			_r$1 = typ[0].Elem(); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			_r$2 = jsType(_r$1); /* */ $s = 2; case 2: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
			/* */ $s = 3; case 3:
			return _r$2.zero();
			/* */ } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._r$2 = _r$2; $f.$s = $s; $f.$r = $r; return $f;
		}; })(typ)), 0); /* */ $s = 4; case 4: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		/* */ $s = 5; case 5:
		return _r$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: MakeSlice }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f.cap = cap; $f.len = len; $f.typ = typ; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.MakeSlice = MakeSlice;
	TypeOf = function(i) {
		var $ptr, i;
		if (!initialized) {
			return new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, ptrType$6.nil, ptrType$7.nil, ptrType$1.nil);
		}
		if ($interfaceIsEqual(i, $ifaceNil)) {
			return $ifaceNil;
		}
		return reflectType(i.constructor);
	};
	$pkg.TypeOf = TypeOf;
	ValueOf = function(i) {
		var $ptr, _r, i, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; i = $f.i; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		if ($interfaceIsEqual(i, $ifaceNil)) {
			return new Value.ptr(ptrType$1.nil, 0, 0);
		}
		_r = makeValue(reflectType(i.constructor), i.$val, 0); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: ValueOf }; } $f.$ptr = $ptr; $f._r = _r; $f.i = i; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.ValueOf = ValueOf;
	rtype.ptr.prototype.ptrTo = function() {
		var $ptr, t;
		t = this;
		return reflectType($ptrType(jsType(t)));
	};
	rtype.prototype.ptrTo = function() { return this.$val.ptrTo(); };
	SliceOf = function(t) {
		var $ptr, t;
		return reflectType($sliceType(jsType(t)));
	};
	$pkg.SliceOf = SliceOf;
	Zero = function(typ) {
		var $ptr, _r, typ, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; typ = $f.typ; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = makeValue(typ, jsType(typ).zero(), 0); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Zero }; } $f.$ptr = $ptr; $f._r = _r; $f.typ = typ; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.Zero = Zero;
	unsafe_New = function(typ) {
		var $ptr, _3, typ;
		_3 = typ.Kind();
		if (_3 === 25) {
			return new (jsType(typ).ptr)();
		} else if (_3 === 17) {
			return jsType(typ).zero();
		} else {
			return $newDataPointer(jsType(typ).zero(), jsType(typ.ptrTo()));
		}
	};
	makeInt = function(f, bits, t) {
		var $ptr, _4, _r, bits, f, ptr, t, typ, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _4 = $f._4; _r = $f._r; bits = $f.bits; f = $f.f; ptr = $f.ptr; t = $f.t; typ = $f.typ; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = t.common(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		typ = _r;
		ptr = unsafe_New(typ);
		_4 = typ.Kind();
		if (_4 === 3) {
			ptr.$set((bits.$low << 24 >> 24));
		} else if (_4 === 4) {
			ptr.$set((bits.$low << 16 >> 16));
		} else if ((_4 === 2) || (_4 === 5)) {
			ptr.$set((bits.$low >> 0));
		} else if (_4 === 6) {
			ptr.$set(new $Int64(bits.$high, bits.$low));
		} else if (_4 === 8) {
			ptr.$set((bits.$low << 24 >>> 24));
		} else if (_4 === 9) {
			ptr.$set((bits.$low << 16 >>> 16));
		} else if ((_4 === 7) || (_4 === 10) || (_4 === 12)) {
			ptr.$set((bits.$low >>> 0));
		} else if (_4 === 11) {
			ptr.$set(bits);
		}
		return new Value.ptr(typ, ptr, (((f | 128) >>> 0) | (typ.Kind() >>> 0)) >>> 0);
		/* */ } return; } if ($f === undefined) { $f = { $blk: makeInt }; } $f.$ptr = $ptr; $f._4 = _4; $f._r = _r; $f.bits = bits; $f.f = f; $f.ptr = ptr; $f.t = t; $f.typ = typ; $f.$s = $s; $f.$r = $r; return $f;
	};
	typedmemmove = function(t, dst, src) {
		var $ptr, dst, src, t;
		dst.$set(src.$get());
	};
	keyFor = function(t, key) {
		var $ptr, k, key, kv, t;
		kv = key;
		if (!(kv.$get === undefined)) {
			kv = kv.$get();
		}
		k = $internalize(jsType(t.Key()).keyFor(kv), $String);
		return [kv, k];
	};
	mapaccess = function(t, m, key) {
		var $ptr, _tuple, entry, k, key, m, t;
		_tuple = keyFor(t, key);
		k = _tuple[1];
		entry = m[$externalize(k, $String)];
		if (entry === undefined) {
			return 0;
		}
		return $newDataPointer(entry.v, jsType(PtrTo(t.Elem())));
	};
	mapassign = function(t, m, key, val) {
		var $ptr, _r, _tuple, entry, et, jsVal, k, key, kv, m, newVal, t, val, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tuple = $f._tuple; entry = $f.entry; et = $f.et; jsVal = $f.jsVal; k = $f.k; key = $f.key; kv = $f.kv; m = $f.m; newVal = $f.newVal; t = $f.t; val = $f.val; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_tuple = keyFor(t, key);
		kv = _tuple[0];
		k = _tuple[1];
		jsVal = val.$get();
		et = t.Elem();
		_r = et.Kind(); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ if (_r === 25) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (_r === 25) { */ case 1:
			newVal = jsType(et).zero();
			copyStruct(newVal, jsVal, et);
			jsVal = newVal;
		/* } */ case 2:
		entry = new ($global.Object)();
		entry.k = kv;
		entry.v = jsVal;
		m[$externalize(k, $String)] = entry;
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: mapassign }; } $f.$ptr = $ptr; $f._r = _r; $f._tuple = _tuple; $f.entry = entry; $f.et = et; $f.jsVal = jsVal; $f.k = k; $f.key = key; $f.kv = kv; $f.m = m; $f.newVal = newVal; $f.t = t; $f.val = val; $f.$s = $s; $f.$r = $r; return $f;
	};
	mapdelete = function(t, m, key) {
		var $ptr, _tuple, k, key, m, t;
		_tuple = keyFor(t, key);
		k = _tuple[1];
		delete m[$externalize(k, $String)];
	};
	mapiterinit = function(t, m) {
		var $ptr, m, t;
		return new mapIter.ptr(t, m, $keys(m), 0);
	};
	mapiterkey = function(it) {
		var $ptr, _r, _r$1, _r$2, it, iter, k, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; it = $f.it; iter = $f.iter; k = $f.k; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		iter = it;
		k = iter.keys[iter.i];
		_r = iter.t.Key(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_r$1 = PtrTo(_r); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_r$2 = jsType(_r$1); /* */ $s = 3; case 3: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		/* */ $s = 4; case 4:
		return $newDataPointer(iter.m[$externalize($internalize(k, $String), $String)].k, _r$2);
		/* */ } return; } if ($f === undefined) { $f = { $blk: mapiterkey }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f.it = it; $f.iter = iter; $f.k = k; $f.$s = $s; $f.$r = $r; return $f;
	};
	mapiternext = function(it) {
		var $ptr, it, iter;
		iter = it;
		iter.i = iter.i + (1) >> 0;
	};
	maplen = function(m) {
		var $ptr, m;
		return $parseInt($keys(m).length);
	};
	cvtDirect = function(v, typ) {
		var $ptr, _6, _arg, _arg$1, _arg$2, _r, _r$1, _r$2, _r$3, _r$4, _r$5, _r$6, _r$7, k, slice, srcVal, typ, v, val, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _6 = $f._6; _arg = $f._arg; _arg$1 = $f._arg$1; _arg$2 = $f._arg$2; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; _r$5 = $f._r$5; _r$6 = $f._r$6; _r$7 = $f._r$7; k = $f.k; slice = $f.slice; srcVal = $f.srcVal; typ = $f.typ; v = $f.v; val = $f.val; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		srcVal = v.object();
		/* */ if (srcVal === jsType(v.typ).nil) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (srcVal === jsType(v.typ).nil) { */ case 1:
			_r = makeValue(typ, jsType(typ).nil, v.flag); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			/* */ $s = 4; case 4:
			return _r;
		/* } */ case 2:
		val = null;
			_r$1 = typ.Kind(); /* */ $s = 6; case 6: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			k = _r$1;
			_6 = k;
			/* */ if (_6 === 23) { $s = 7; continue; }
			/* */ if (_6 === 22) { $s = 8; continue; }
			/* */ if (_6 === 25) { $s = 9; continue; }
			/* */ if ((_6 === 17) || (_6 === 1) || (_6 === 18) || (_6 === 19) || (_6 === 20) || (_6 === 21) || (_6 === 24)) { $s = 10; continue; }
			/* */ $s = 11; continue;
			/* if (_6 === 23) { */ case 7:
				slice = new (jsType(typ))(srcVal.$array);
				slice.$offset = srcVal.$offset;
				slice.$length = srcVal.$length;
				slice.$capacity = srcVal.$capacity;
				val = $newDataPointer(slice, jsType(PtrTo(typ)));
				$s = 12; continue;
			/* } else if (_6 === 22) { */ case 8:
				_r$2 = typ.Elem(); /* */ $s = 15; case 15: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
				_r$3 = _r$2.Kind(); /* */ $s = 16; case 16: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
				/* */ if (_r$3 === 25) { $s = 13; continue; }
				/* */ $s = 14; continue;
				/* if (_r$3 === 25) { */ case 13:
					_r$4 = typ.Elem(); /* */ $s = 19; case 19: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
					/* */ if ($interfaceIsEqual(_r$4, v.typ.Elem())) { $s = 17; continue; }
					/* */ $s = 18; continue;
					/* if ($interfaceIsEqual(_r$4, v.typ.Elem())) { */ case 17:
						val = srcVal;
						/* break; */ $s = 5; continue;
					/* } */ case 18:
					val = new (jsType(typ))();
					_arg = val;
					_arg$1 = srcVal;
					_r$5 = typ.Elem(); /* */ $s = 20; case 20: if($c) { $c = false; _r$5 = _r$5.$blk(); } if (_r$5 && _r$5.$blk !== undefined) { break s; }
					_arg$2 = _r$5;
					$r = copyStruct(_arg, _arg$1, _arg$2); /* */ $s = 21; case 21: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					/* break; */ $s = 5; continue;
				/* } */ case 14:
				val = new (jsType(typ))(srcVal.$get, srcVal.$set);
				$s = 12; continue;
			/* } else if (_6 === 25) { */ case 9:
				val = new (jsType(typ).ptr)();
				copyStruct(val, srcVal, typ);
				$s = 12; continue;
			/* } else if ((_6 === 17) || (_6 === 1) || (_6 === 18) || (_6 === 19) || (_6 === 20) || (_6 === 21) || (_6 === 24)) { */ case 10:
				val = v.ptr;
				$s = 12; continue;
			/* } else { */ case 11:
				$panic(new ValueError.ptr("reflect.Convert", k));
			/* } */ case 12:
		case 5:
		_r$6 = typ.common(); /* */ $s = 22; case 22: if($c) { $c = false; _r$6 = _r$6.$blk(); } if (_r$6 && _r$6.$blk !== undefined) { break s; }
		_r$7 = typ.Kind(); /* */ $s = 23; case 23: if($c) { $c = false; _r$7 = _r$7.$blk(); } if (_r$7 && _r$7.$blk !== undefined) { break s; }
		/* */ $s = 24; case 24:
		return new Value.ptr(_r$6, val, (((v.flag & 224) >>> 0) | (_r$7 >>> 0)) >>> 0);
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtDirect }; } $f.$ptr = $ptr; $f._6 = _6; $f._arg = _arg; $f._arg$1 = _arg$1; $f._arg$2 = _arg$2; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._r$5 = _r$5; $f._r$6 = _r$6; $f._r$7 = _r$7; $f.k = k; $f.slice = slice; $f.srcVal = srcVal; $f.typ = typ; $f.v = v; $f.val = val; $f.$s = $s; $f.$r = $r; return $f;
	};
	methodReceiver = function(op, v, i) {
		var $ptr, fn, i, iface, m, m$1, op, prop, rcvr, rcvrtype, t, tt, ut, v, x, x$1;
		rcvrtype = ptrType$1.nil;
		t = ptrType$1.nil;
		fn = 0;
		v = v;
		prop = "";
		if (v.typ.Kind() === 20) {
			tt = v.typ.kindType;
			if (i < 0 || i >= tt.methods.$length) {
				$panic(new $String("reflect: internal error: invalid method index"));
			}
			m = (x = tt.methods, ((i < 0 || i >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + i]));
			if (!(m.pkgPath === ptrType$6.nil)) {
				$panic(new $String("reflect: " + op + " of unexported method"));
			}
			iface = $pointerOfStructConversion(v.ptr, ptrType$8);
			if (iface.itab === ptrType$9.nil) {
				$panic(new $String("reflect: " + op + " of method on nil interface value"));
			}
			t = m.typ;
			prop = m.name.$get();
		} else {
			ut = v.typ.uncommonType.uncommon();
			if (ut === ptrType$7.nil || i < 0 || i >= ut.methods.$length) {
				$panic(new $String("reflect: internal error: invalid method index"));
			}
			m$1 = (x$1 = ut.methods, ((i < 0 || i >= x$1.$length) ? $throwRuntimeError("index out of range") : x$1.$array[x$1.$offset + i]));
			if (!(m$1.pkgPath === ptrType$6.nil)) {
				$panic(new $String("reflect: " + op + " of unexported method"));
			}
			t = m$1.mtyp;
			prop = $internalize($methodSet(jsType(v.typ))[i].prop, $String);
		}
		rcvr = v.object();
		if (isWrapped(v.typ)) {
			rcvr = new (jsType(v.typ))(rcvr);
		}
		fn = rcvr[$externalize(prop, $String)];
		return [rcvrtype, t, fn];
	};
	valueInterface = function(v, safe) {
		var $ptr, _r, safe, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; safe = $f.safe; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		if (v.flag === 0) {
			$panic(new ValueError.ptr("reflect.Value.Interface", 0));
		}
		if (safe && !((((v.flag & 96) >>> 0) === 0))) {
			$panic(new $String("reflect.Value.Interface: cannot return value obtained from unexported field or method"));
		}
		/* */ if (!((((v.flag & 512) >>> 0) === 0))) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!((((v.flag & 512) >>> 0) === 0))) { */ case 1:
			_r = makeMethodValue("Interface", v); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			v = _r;
		/* } */ case 2:
		if (isWrapped(v.typ)) {
			return new (jsType(v.typ))(v.object());
		}
		return v.object();
		/* */ } return; } if ($f === undefined) { $f = { $blk: valueInterface }; } $f.$ptr = $ptr; $f._r = _r; $f.safe = safe; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	ifaceE2I = function(t, src, dst) {
		var $ptr, dst, src, t;
		dst.$set(src);
	};
	methodName = function() {
		var $ptr;
		return "?FIXME?";
	};
	makeMethodValue = function(op, v) {
		var $ptr, _r, _tuple, fn, fv, op, rcvr, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tuple = $f._tuple; fn = $f.fn; fv = $f.fv; op = $f.op; rcvr = $f.rcvr; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		fn = [fn];
		rcvr = [rcvr];
		v = v;
		if (((v.flag & 512) >>> 0) === 0) {
			$panic(new $String("reflect: internal error: invalid use of makePartialFunc"));
		}
		_tuple = methodReceiver(op, v, (v.flag >> 0) >> 10 >> 0);
		fn[0] = _tuple[2];
		rcvr[0] = v.object();
		if (isWrapped(v.typ)) {
			rcvr[0] = new (jsType(v.typ))(rcvr[0]);
		}
		fv = $makeFunc((function(fn, rcvr) { return function(arguments$1) {
			var $ptr, arguments$1;
			return fn[0].apply(rcvr[0], $externalize(arguments$1, sliceType$7));
		}; })(fn, rcvr));
		_r = v.Type().common(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return new Value.ptr(_r, fv, (((v.flag & 96) >>> 0) | 19) >>> 0);
		/* */ } return; } if ($f === undefined) { $f = { $blk: makeMethodValue }; } $f.$ptr = $ptr; $f._r = _r; $f._tuple = _tuple; $f.fn = fn; $f.fv = fv; $f.op = op; $f.rcvr = rcvr; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	rtype.ptr.prototype.pointers = function() {
		var $ptr, _7, t;
		t = this;
		_7 = t.Kind();
		if ((_7 === 22) || (_7 === 21) || (_7 === 18) || (_7 === 19) || (_7 === 25) || (_7 === 17)) {
			return true;
		} else {
			return false;
		}
	};
	rtype.prototype.pointers = function() { return this.$val.pointers(); };
	rtype.ptr.prototype.Comparable = function() {
		var $ptr, _8, _r, _r$1, _r$2, i, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _8 = $f._8; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; i = $f.i; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
			_8 = t.Kind();
			/* */ if ((_8 === 19) || (_8 === 23) || (_8 === 21)) { $s = 2; continue; }
			/* */ if (_8 === 17) { $s = 3; continue; }
			/* */ if (_8 === 25) { $s = 4; continue; }
			/* */ $s = 5; continue;
			/* if ((_8 === 19) || (_8 === 23) || (_8 === 21)) { */ case 2:
				return false;
			/* } else if (_8 === 17) { */ case 3:
				_r = t.Elem().Comparable(); /* */ $s = 6; case 6: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				/* */ $s = 7; case 7:
				return _r;
			/* } else if (_8 === 25) { */ case 4:
				i = 0;
				/* while (true) { */ case 8:
					/* if (!(i < t.NumField())) { break; } */ if(!(i < t.NumField())) { $s = 9; continue; }
					_r$1 = t.Field(i); /* */ $s = 12; case 12: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
					_r$2 = _r$1.Type.Comparable(); /* */ $s = 13; case 13: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
					/* */ if (!_r$2) { $s = 10; continue; }
					/* */ $s = 11; continue;
					/* if (!_r$2) { */ case 10:
						return false;
					/* } */ case 11:
					i = i + (1) >> 0;
				/* } */ $s = 8; continue; case 9:
			/* } */ case 5:
		case 1:
		return true;
		/* */ } return; } if ($f === undefined) { $f = { $blk: rtype.ptr.prototype.Comparable }; } $f.$ptr = $ptr; $f._8 = _8; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f.i = i; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	rtype.prototype.Comparable = function() { return this.$val.Comparable(); };
	uncommonType.ptr.prototype.Method = function(i) {
		var $ptr, fl, fn, i, m, mt, p, prop, t, x;
		m = new Method.ptr("", "", $ifaceNil, new Value.ptr(ptrType$1.nil, 0, 0), 0);
		t = this;
		if (t === ptrType$7.nil || i < 0 || i >= t.methods.$length) {
			$panic(new $String("reflect: Method index out of range"));
		}
		p = (x = t.methods, ((i < 0 || i >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + i]));
		if (!(p.name === ptrType$6.nil)) {
			m.Name = p.name.$get();
		}
		fl = 19;
		if (!(p.pkgPath === ptrType$6.nil)) {
			m.PkgPath = p.pkgPath.$get();
			fl = (fl | (32)) >>> 0;
		}
		mt = p.typ;
		m.Type = mt;
		prop = $internalize($methodSet(t.jsType)[i].prop, $String);
		fn = $makeFunc((function(arguments$1) {
			var $ptr, arguments$1, rcvr;
			rcvr = (0 >= arguments$1.$length ? $throwRuntimeError("index out of range") : arguments$1.$array[arguments$1.$offset + 0]);
			return rcvr[$externalize(prop, $String)].apply(rcvr, $externalize($subslice(arguments$1, 1), sliceType$7));
		}));
		m.Func = new Value.ptr(mt, fn, fl);
		m.Index = i;
		return m;
	};
	uncommonType.prototype.Method = function(i) { return this.$val.Method(i); };
	Value.ptr.prototype.object = function() {
		var $ptr, _9, newVal, v, val;
		v = this;
		if ((v.typ.Kind() === 17) || (v.typ.Kind() === 25)) {
			return v.ptr;
		}
		if (!((((v.flag & 128) >>> 0) === 0))) {
			val = v.ptr.$get();
			if (!(val === $ifaceNil) && !(val.constructor === jsType(v.typ))) {
				switch (0) { default:
					_9 = v.typ.Kind();
					if ((_9 === 11) || (_9 === 6)) {
						val = new (jsType(v.typ))(val.$high, val.$low);
					} else if ((_9 === 15) || (_9 === 16)) {
						val = new (jsType(v.typ))(val.$real, val.$imag);
					} else if (_9 === 23) {
						if (val === val.constructor.nil) {
							val = jsType(v.typ).nil;
							break;
						}
						newVal = new (jsType(v.typ))(val.$array);
						newVal.$offset = val.$offset;
						newVal.$length = val.$length;
						newVal.$capacity = val.$capacity;
						val = newVal;
					}
				}
			}
			return val;
		}
		return v.ptr;
	};
	Value.prototype.object = function() { return this.$val.object(); };
	Value.ptr.prototype.call = function(op, in$1) {
		var $ptr, _10, _arg, _arg$1, _arg$2, _arg$3, _i, _i$1, _i$2, _r, _r$1, _r$10, _r$11, _r$12, _r$13, _r$14, _r$15, _r$2, _r$3, _r$4, _r$5, _r$6, _r$7, _r$8, _r$9, _ref, _ref$1, _ref$2, _tmp, _tmp$1, _tuple, arg, argsArray, elem, fn, i, i$1, i$2, i$3, in$1, isSlice, m, n, nin, nout, op, origIn, rcvr, results, ret, slice, t, targ, v, x, x$1, x$2, xt, xt$1, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _10 = $f._10; _arg = $f._arg; _arg$1 = $f._arg$1; _arg$2 = $f._arg$2; _arg$3 = $f._arg$3; _i = $f._i; _i$1 = $f._i$1; _i$2 = $f._i$2; _r = $f._r; _r$1 = $f._r$1; _r$10 = $f._r$10; _r$11 = $f._r$11; _r$12 = $f._r$12; _r$13 = $f._r$13; _r$14 = $f._r$14; _r$15 = $f._r$15; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; _r$5 = $f._r$5; _r$6 = $f._r$6; _r$7 = $f._r$7; _r$8 = $f._r$8; _r$9 = $f._r$9; _ref = $f._ref; _ref$1 = $f._ref$1; _ref$2 = $f._ref$2; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tuple = $f._tuple; arg = $f.arg; argsArray = $f.argsArray; elem = $f.elem; fn = $f.fn; i = $f.i; i$1 = $f.i$1; i$2 = $f.i$2; i$3 = $f.i$3; in$1 = $f.in$1; isSlice = $f.isSlice; m = $f.m; n = $f.n; nin = $f.nin; nout = $f.nout; op = $f.op; origIn = $f.origIn; rcvr = $f.rcvr; results = $f.results; ret = $f.ret; slice = $f.slice; t = $f.t; targ = $f.targ; v = $f.v; x = $f.x; x$1 = $f.x$1; x$2 = $f.x$2; xt = $f.xt; xt$1 = $f.xt$1; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		t = v.typ;
		fn = 0;
		rcvr = null;
		if (!((((v.flag & 512) >>> 0) === 0))) {
			_tuple = methodReceiver(op, v, (v.flag >> 0) >> 10 >> 0);
			t = _tuple[1];
			fn = _tuple[2];
			rcvr = v.object();
			if (isWrapped(v.typ)) {
				rcvr = new (jsType(v.typ))(rcvr);
			}
		} else {
			fn = v.object();
			rcvr = undefined;
		}
		if (fn === 0) {
			$panic(new $String("reflect.Value.Call: call of nil function"));
		}
		isSlice = op === "CallSlice";
		n = t.NumIn();
		if (isSlice) {
			if (!t.IsVariadic()) {
				$panic(new $String("reflect: CallSlice of non-variadic function"));
			}
			if (in$1.$length < n) {
				$panic(new $String("reflect: CallSlice with too few input arguments"));
			}
			if (in$1.$length > n) {
				$panic(new $String("reflect: CallSlice with too many input arguments"));
			}
		} else {
			if (t.IsVariadic()) {
				n = n - (1) >> 0;
			}
			if (in$1.$length < n) {
				$panic(new $String("reflect: Call with too few input arguments"));
			}
			if (!t.IsVariadic() && in$1.$length > n) {
				$panic(new $String("reflect: Call with too many input arguments"));
			}
		}
		_ref = in$1;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			x = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			if (x.Kind() === 0) {
				$panic(new $String("reflect: " + op + " using zero Value argument"));
			}
			_i++;
		}
		i = 0;
		/* while (true) { */ case 1:
			/* if (!(i < n)) { break; } */ if(!(i < n)) { $s = 2; continue; }
			_tmp = ((i < 0 || i >= in$1.$length) ? $throwRuntimeError("index out of range") : in$1.$array[in$1.$offset + i]).Type();
			_tmp$1 = t.In(i);
			xt = _tmp;
			targ = _tmp$1;
			_r = xt.AssignableTo(targ); /* */ $s = 5; case 5: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			/* */ if (!_r) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (!_r) { */ case 3:
				_r$1 = xt.String(); /* */ $s = 6; case 6: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
				_r$2 = targ.String(); /* */ $s = 7; case 7: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
				$panic(new $String("reflect: " + op + " using " + _r$1 + " as type " + _r$2));
			/* } */ case 4:
			i = i + (1) >> 0;
		/* } */ $s = 1; continue; case 2:
		/* */ if (!isSlice && t.IsVariadic()) { $s = 8; continue; }
		/* */ $s = 9; continue;
		/* if (!isSlice && t.IsVariadic()) { */ case 8:
			m = in$1.$length - n >> 0;
			_r$3 = MakeSlice(t.In(n), m, m); /* */ $s = 10; case 10: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
			slice = _r$3;
			_r$4 = t.In(n).Elem(); /* */ $s = 11; case 11: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
			elem = _r$4;
			i$1 = 0;
			/* while (true) { */ case 12:
				/* if (!(i$1 < m)) { break; } */ if(!(i$1 < m)) { $s = 13; continue; }
				x$2 = (x$1 = n + i$1 >> 0, ((x$1 < 0 || x$1 >= in$1.$length) ? $throwRuntimeError("index out of range") : in$1.$array[in$1.$offset + x$1]));
				xt$1 = x$2.Type();
				_r$5 = xt$1.AssignableTo(elem); /* */ $s = 16; case 16: if($c) { $c = false; _r$5 = _r$5.$blk(); } if (_r$5 && _r$5.$blk !== undefined) { break s; }
				/* */ if (!_r$5) { $s = 14; continue; }
				/* */ $s = 15; continue;
				/* if (!_r$5) { */ case 14:
					_r$6 = xt$1.String(); /* */ $s = 17; case 17: if($c) { $c = false; _r$6 = _r$6.$blk(); } if (_r$6 && _r$6.$blk !== undefined) { break s; }
					_r$7 = elem.String(); /* */ $s = 18; case 18: if($c) { $c = false; _r$7 = _r$7.$blk(); } if (_r$7 && _r$7.$blk !== undefined) { break s; }
					$panic(new $String("reflect: cannot use " + _r$6 + " as type " + _r$7 + " in " + op));
				/* } */ case 15:
				_r$8 = slice.Index(i$1); /* */ $s = 19; case 19: if($c) { $c = false; _r$8 = _r$8.$blk(); } if (_r$8 && _r$8.$blk !== undefined) { break s; }
				$r = _r$8.Set(x$2); /* */ $s = 20; case 20: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				i$1 = i$1 + (1) >> 0;
			/* } */ $s = 12; continue; case 13:
			origIn = in$1;
			in$1 = $makeSlice(sliceType$8, (n + 1 >> 0));
			$copySlice($subslice(in$1, 0, n), origIn);
			((n < 0 || n >= in$1.$length) ? $throwRuntimeError("index out of range") : in$1.$array[in$1.$offset + n] = slice);
		/* } */ case 9:
		nin = in$1.$length;
		if (!((nin === t.NumIn()))) {
			$panic(new $String("reflect.Value.Call: wrong argument count"));
		}
		nout = t.NumOut();
		argsArray = new ($global.Array)(t.NumIn());
		_ref$1 = in$1;
		_i$1 = 0;
		/* while (true) { */ case 21:
			/* if (!(_i$1 < _ref$1.$length)) { break; } */ if(!(_i$1 < _ref$1.$length)) { $s = 22; continue; }
			i$2 = _i$1;
			arg = ((_i$1 < 0 || _i$1 >= _ref$1.$length) ? $throwRuntimeError("index out of range") : _ref$1.$array[_ref$1.$offset + _i$1]);
			_arg = t.In(i$2);
			_r$9 = t.In(i$2).common(); /* */ $s = 23; case 23: if($c) { $c = false; _r$9 = _r$9.$blk(); } if (_r$9 && _r$9.$blk !== undefined) { break s; }
			_arg$1 = _r$9;
			_arg$2 = 0;
			_r$10 = arg.assignTo("reflect.Value.Call", _arg$1, _arg$2); /* */ $s = 24; case 24: if($c) { $c = false; _r$10 = _r$10.$blk(); } if (_r$10 && _r$10.$blk !== undefined) { break s; }
			_r$11 = _r$10.object(); /* */ $s = 25; case 25: if($c) { $c = false; _r$11 = _r$11.$blk(); } if (_r$11 && _r$11.$blk !== undefined) { break s; }
			_arg$3 = _r$11;
			_r$12 = unwrapJsObject(_arg, _arg$3); /* */ $s = 26; case 26: if($c) { $c = false; _r$12 = _r$12.$blk(); } if (_r$12 && _r$12.$blk !== undefined) { break s; }
			argsArray[i$2] = _r$12;
			_i$1++;
		/* } */ $s = 21; continue; case 22:
		_r$13 = callHelper(new sliceType$2([new $jsObjectPtr(fn), new $jsObjectPtr(rcvr), new $jsObjectPtr(argsArray)])); /* */ $s = 27; case 27: if($c) { $c = false; _r$13 = _r$13.$blk(); } if (_r$13 && _r$13.$blk !== undefined) { break s; }
		results = _r$13;
			_10 = nout;
			/* */ if (_10 === 0) { $s = 29; continue; }
			/* */ if (_10 === 1) { $s = 30; continue; }
			/* */ $s = 31; continue;
			/* if (_10 === 0) { */ case 29:
				return sliceType$8.nil;
			/* } else if (_10 === 1) { */ case 30:
				_r$14 = makeValue(t.Out(0), wrapJsObject(t.Out(0), results), 0); /* */ $s = 33; case 33: if($c) { $c = false; _r$14 = _r$14.$blk(); } if (_r$14 && _r$14.$blk !== undefined) { break s; }
				/* */ $s = 34; case 34:
				return new sliceType$8([$clone(_r$14, Value)]);
			/* } else { */ case 31:
				ret = $makeSlice(sliceType$8, nout);
				_ref$2 = ret;
				_i$2 = 0;
				/* while (true) { */ case 35:
					/* if (!(_i$2 < _ref$2.$length)) { break; } */ if(!(_i$2 < _ref$2.$length)) { $s = 36; continue; }
					i$3 = _i$2;
					_r$15 = makeValue(t.Out(i$3), wrapJsObject(t.Out(i$3), results[i$3]), 0); /* */ $s = 37; case 37: if($c) { $c = false; _r$15 = _r$15.$blk(); } if (_r$15 && _r$15.$blk !== undefined) { break s; }
					((i$3 < 0 || i$3 >= ret.$length) ? $throwRuntimeError("index out of range") : ret.$array[ret.$offset + i$3] = _r$15);
					_i$2++;
				/* } */ $s = 35; continue; case 36:
				return ret;
			/* } */ case 32:
		case 28:
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.call }; } $f.$ptr = $ptr; $f._10 = _10; $f._arg = _arg; $f._arg$1 = _arg$1; $f._arg$2 = _arg$2; $f._arg$3 = _arg$3; $f._i = _i; $f._i$1 = _i$1; $f._i$2 = _i$2; $f._r = _r; $f._r$1 = _r$1; $f._r$10 = _r$10; $f._r$11 = _r$11; $f._r$12 = _r$12; $f._r$13 = _r$13; $f._r$14 = _r$14; $f._r$15 = _r$15; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._r$5 = _r$5; $f._r$6 = _r$6; $f._r$7 = _r$7; $f._r$8 = _r$8; $f._r$9 = _r$9; $f._ref = _ref; $f._ref$1 = _ref$1; $f._ref$2 = _ref$2; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tuple = _tuple; $f.arg = arg; $f.argsArray = argsArray; $f.elem = elem; $f.fn = fn; $f.i = i; $f.i$1 = i$1; $f.i$2 = i$2; $f.i$3 = i$3; $f.in$1 = in$1; $f.isSlice = isSlice; $f.m = m; $f.n = n; $f.nin = nin; $f.nout = nout; $f.op = op; $f.origIn = origIn; $f.rcvr = rcvr; $f.results = results; $f.ret = ret; $f.slice = slice; $f.t = t; $f.targ = targ; $f.v = v; $f.x = x; $f.x$1 = x$1; $f.x$2 = x$2; $f.xt = xt; $f.xt$1 = xt$1; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.call = function(op, in$1) { return this.$val.call(op, in$1); };
	Value.ptr.prototype.Cap = function() {
		var $ptr, _11, k, v;
		v = this;
		k = new flag(v.flag).kind();
		_11 = k;
		if (_11 === 17) {
			return v.typ.Len();
		} else if ((_11 === 18) || (_11 === 23)) {
			return $parseInt(v.object().$capacity) >> 0;
		}
		$panic(new ValueError.ptr("reflect.Value.Cap", k));
	};
	Value.prototype.Cap = function() { return this.$val.Cap(); };
	wrapJsObject = function(typ, val) {
		var $ptr, typ, val;
		if ($interfaceIsEqual(typ, jsObjectPtr)) {
			return new (jsType(jsObjectPtr))(val);
		}
		return val;
	};
	unwrapJsObject = function(typ, val) {
		var $ptr, typ, val;
		if ($interfaceIsEqual(typ, jsObjectPtr)) {
			return val.object;
		}
		return val;
	};
	Value.ptr.prototype.Elem = function() {
		var $ptr, _12, _r, fl, k, tt, typ, v, val, val$1, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _12 = $f._12; _r = $f._r; fl = $f.fl; k = $f.k; tt = $f.tt; typ = $f.typ; v = $f.v; val = $f.val; val$1 = $f.val$1; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
			k = new flag(v.flag).kind();
			_12 = k;
			/* */ if (_12 === 20) { $s = 2; continue; }
			/* */ if (_12 === 22) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (_12 === 20) { */ case 2:
				val = v.object();
				if (val === $ifaceNil) {
					return new Value.ptr(ptrType$1.nil, 0, 0);
				}
				typ = reflectType(val.constructor);
				_r = makeValue(typ, val.$val, (v.flag & 96) >>> 0); /* */ $s = 6; case 6: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				/* */ $s = 7; case 7:
				return _r;
			/* } else if (_12 === 22) { */ case 3:
				if (v.IsNil()) {
					return new Value.ptr(ptrType$1.nil, 0, 0);
				}
				val$1 = v.object();
				tt = v.typ.kindType;
				fl = (((((v.flag & 96) >>> 0) | 128) >>> 0) | 256) >>> 0;
				fl = (fl | ((tt.elem.Kind() >>> 0))) >>> 0;
				return new Value.ptr(tt.elem, wrapJsObject(tt.elem, val$1), fl);
			/* } else { */ case 4:
				$panic(new ValueError.ptr("reflect.Value.Elem", k));
			/* } */ case 5:
		case 1:
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.Elem }; } $f.$ptr = $ptr; $f._12 = _12; $f._r = _r; $f.fl = fl; $f.k = k; $f.tt = tt; $f.typ = typ; $f.v = v; $f.val = val; $f.val$1 = val$1; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.Elem = function() { return this.$val.Elem(); };
	Value.ptr.prototype.Field = function(i) {
		var $ptr, _r, _r$1, _r$2, field, fl, i, jsTag, o, prop, s, tag, tt, typ, v, x, x$1, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; field = $f.field; fl = $f.fl; i = $f.i; jsTag = $f.jsTag; o = $f.o; prop = $f.prop; s = $f.s; tag = $f.tag; tt = $f.tt; typ = $f.typ; v = $f.v; x = $f.x; x$1 = $f.x$1; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		jsTag = [jsTag];
		prop = [prop];
		s = [s];
		typ = [typ];
		v = this;
		new flag(v.flag).mustBe(25);
		tt = v.typ.kindType;
		if (i < 0 || i >= tt.fields.$length) {
			$panic(new $String("reflect: Field index out of range"));
		}
		prop[0] = $internalize(jsType(v.typ).fields[i].prop, $String);
		field = (x = tt.fields, ((i < 0 || i >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + i]));
		typ[0] = field.typ;
		fl = (((v.flag & 416) >>> 0) | (typ[0].Kind() >>> 0)) >>> 0;
		if (!(field.pkgPath === ptrType$6.nil)) {
			if (field.name === ptrType$6.nil) {
				fl = (fl | (64)) >>> 0;
			} else {
				fl = (fl | (32)) >>> 0;
			}
		}
		tag = (x$1 = tt.fields, ((i < 0 || i >= x$1.$length) ? $throwRuntimeError("index out of range") : x$1.$array[x$1.$offset + i])).tag;
		/* */ if (!(tag === ptrType$6.nil) && !((i === 0))) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!(tag === ptrType$6.nil) && !((i === 0))) { */ case 1:
			jsTag[0] = getJsTag(tag.$get());
			/* */ if (!(jsTag[0] === "")) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (!(jsTag[0] === "")) { */ case 3:
				/* while (true) { */ case 5:
					o = [o];
					_r = v.Field(0); /* */ $s = 7; case 7: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
					v = _r;
					/* */ if (v.typ === jsObjectPtr) { $s = 8; continue; }
					/* */ $s = 9; continue;
					/* if (v.typ === jsObjectPtr) { */ case 8:
						o[0] = v.object().object;
						return new Value.ptr(typ[0], new (jsType(PtrTo(typ[0])))((function(jsTag, o, prop, s, typ) { return function() {
							var $ptr;
							return $internalize(o[0][$externalize(jsTag[0], $String)], jsType(typ[0]));
						}; })(jsTag, o, prop, s, typ), (function(jsTag, o, prop, s, typ) { return function(x$2) {
							var $ptr, x$2;
							o[0][$externalize(jsTag[0], $String)] = $externalize(x$2, jsType(typ[0]));
						}; })(jsTag, o, prop, s, typ)), fl);
					/* } */ case 9:
					/* */ if (v.typ.Kind() === 22) { $s = 10; continue; }
					/* */ $s = 11; continue;
					/* if (v.typ.Kind() === 22) { */ case 10:
						_r$1 = v.Elem(); /* */ $s = 12; case 12: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
						v = _r$1;
					/* } */ case 11:
				/* } */ $s = 5; continue; case 6:
			/* } */ case 4:
		/* } */ case 2:
		s[0] = v.ptr;
		/* */ if (!((((fl & 128) >>> 0) === 0)) && !((typ[0].Kind() === 17)) && !((typ[0].Kind() === 25))) { $s = 13; continue; }
		/* */ $s = 14; continue;
		/* if (!((((fl & 128) >>> 0) === 0)) && !((typ[0].Kind() === 17)) && !((typ[0].Kind() === 25))) { */ case 13:
			return new Value.ptr(typ[0], new (jsType(PtrTo(typ[0])))((function(jsTag, prop, s, typ) { return function() {
				var $ptr;
				return wrapJsObject(typ[0], s[0][$externalize(prop[0], $String)]);
			}; })(jsTag, prop, s, typ), (function(jsTag, prop, s, typ) { return function(x$2) {
				var $ptr, x$2;
				s[0][$externalize(prop[0], $String)] = unwrapJsObject(typ[0], x$2);
			}; })(jsTag, prop, s, typ)), fl);
		/* } */ case 14:
		_r$2 = makeValue(typ[0], wrapJsObject(typ[0], s[0][$externalize(prop[0], $String)]), fl); /* */ $s = 15; case 15: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		/* */ $s = 16; case 16:
		return _r$2;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.Field }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f.field = field; $f.fl = fl; $f.i = i; $f.jsTag = jsTag; $f.o = o; $f.prop = prop; $f.s = s; $f.tag = tag; $f.tt = tt; $f.typ = typ; $f.v = v; $f.x = x; $f.x$1 = x$1; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.Field = function(i) { return this.$val.Field(i); };
	getJsTag = function(tag) {
		var $ptr, _tuple, i, name, qvalue, tag, value;
		while (true) {
			if (!(!(tag === ""))) { break; }
			i = 0;
			while (true) {
				if (!(i < tag.length && (tag.charCodeAt(i) === 32))) { break; }
				i = i + (1) >> 0;
			}
			tag = tag.substring(i);
			if (tag === "") {
				break;
			}
			i = 0;
			while (true) {
				if (!(i < tag.length && !((tag.charCodeAt(i) === 32)) && !((tag.charCodeAt(i) === 58)) && !((tag.charCodeAt(i) === 34)))) { break; }
				i = i + (1) >> 0;
			}
			if ((i + 1 >> 0) >= tag.length || !((tag.charCodeAt(i) === 58)) || !((tag.charCodeAt((i + 1 >> 0)) === 34))) {
				break;
			}
			name = tag.substring(0, i);
			tag = tag.substring((i + 1 >> 0));
			i = 1;
			while (true) {
				if (!(i < tag.length && !((tag.charCodeAt(i) === 34)))) { break; }
				if (tag.charCodeAt(i) === 92) {
					i = i + (1) >> 0;
				}
				i = i + (1) >> 0;
			}
			if (i >= tag.length) {
				break;
			}
			qvalue = tag.substring(0, (i + 1 >> 0));
			tag = tag.substring((i + 1 >> 0));
			if (name === "js") {
				_tuple = strconv.Unquote(qvalue);
				value = _tuple[0];
				return value;
			}
		}
		return "";
	};
	Value.ptr.prototype.Index = function(i) {
		var $ptr, _13, _r, _r$1, a, a$1, c, fl, fl$1, fl$2, i, k, s, str, tt, tt$1, typ, typ$1, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _13 = $f._13; _r = $f._r; _r$1 = $f._r$1; a = $f.a; a$1 = $f.a$1; c = $f.c; fl = $f.fl; fl$1 = $f.fl$1; fl$2 = $f.fl$2; i = $f.i; k = $f.k; s = $f.s; str = $f.str; tt = $f.tt; tt$1 = $f.tt$1; typ = $f.typ; typ$1 = $f.typ$1; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		a = [a];
		a$1 = [a$1];
		c = [c];
		i = [i];
		typ = [typ];
		typ$1 = [typ$1];
		v = this;
			k = new flag(v.flag).kind();
			_13 = k;
			/* */ if (_13 === 17) { $s = 2; continue; }
			/* */ if (_13 === 23) { $s = 3; continue; }
			/* */ if (_13 === 24) { $s = 4; continue; }
			/* */ $s = 5; continue;
			/* if (_13 === 17) { */ case 2:
				tt = v.typ.kindType;
				if (i[0] < 0 || i[0] > (tt.len >> 0)) {
					$panic(new $String("reflect: array index out of range"));
				}
				typ$1[0] = tt.elem;
				fl = (v.flag & 480) >>> 0;
				fl = (fl | ((typ$1[0].Kind() >>> 0))) >>> 0;
				a$1[0] = v.ptr;
				/* */ if (!((((fl & 128) >>> 0) === 0)) && !((typ$1[0].Kind() === 17)) && !((typ$1[0].Kind() === 25))) { $s = 7; continue; }
				/* */ $s = 8; continue;
				/* if (!((((fl & 128) >>> 0) === 0)) && !((typ$1[0].Kind() === 17)) && !((typ$1[0].Kind() === 25))) { */ case 7:
					return new Value.ptr(typ$1[0], new (jsType(PtrTo(typ$1[0])))((function(a, a$1, c, i, typ, typ$1) { return function() {
						var $ptr;
						return wrapJsObject(typ$1[0], a$1[0][i[0]]);
					}; })(a, a$1, c, i, typ, typ$1), (function(a, a$1, c, i, typ, typ$1) { return function(x) {
						var $ptr, x;
						a$1[0][i[0]] = unwrapJsObject(typ$1[0], x);
					}; })(a, a$1, c, i, typ, typ$1)), fl);
				/* } */ case 8:
				_r = makeValue(typ$1[0], wrapJsObject(typ$1[0], a$1[0][i[0]]), fl); /* */ $s = 9; case 9: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				/* */ $s = 10; case 10:
				return _r;
			/* } else if (_13 === 23) { */ case 3:
				s = v.object();
				if (i[0] < 0 || i[0] >= ($parseInt(s.$length) >> 0)) {
					$panic(new $String("reflect: slice index out of range"));
				}
				tt$1 = v.typ.kindType;
				typ[0] = tt$1.elem;
				fl$1 = (384 | ((v.flag & 96) >>> 0)) >>> 0;
				fl$1 = (fl$1 | ((typ[0].Kind() >>> 0))) >>> 0;
				i[0] = i[0] + (($parseInt(s.$offset) >> 0)) >> 0;
				a[0] = s.$array;
				/* */ if (!((((fl$1 & 128) >>> 0) === 0)) && !((typ[0].Kind() === 17)) && !((typ[0].Kind() === 25))) { $s = 11; continue; }
				/* */ $s = 12; continue;
				/* if (!((((fl$1 & 128) >>> 0) === 0)) && !((typ[0].Kind() === 17)) && !((typ[0].Kind() === 25))) { */ case 11:
					return new Value.ptr(typ[0], new (jsType(PtrTo(typ[0])))((function(a, a$1, c, i, typ, typ$1) { return function() {
						var $ptr;
						return wrapJsObject(typ[0], a[0][i[0]]);
					}; })(a, a$1, c, i, typ, typ$1), (function(a, a$1, c, i, typ, typ$1) { return function(x) {
						var $ptr, x;
						a[0][i[0]] = unwrapJsObject(typ[0], x);
					}; })(a, a$1, c, i, typ, typ$1)), fl$1);
				/* } */ case 12:
				_r$1 = makeValue(typ[0], wrapJsObject(typ[0], a[0][i[0]]), fl$1); /* */ $s = 13; case 13: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
				/* */ $s = 14; case 14:
				return _r$1;
			/* } else if (_13 === 24) { */ case 4:
				str = v.ptr.$get();
				if (i[0] < 0 || i[0] >= str.length) {
					$panic(new $String("reflect: string index out of range"));
				}
				fl$2 = (((v.flag & 96) >>> 0) | 8) >>> 0;
				c[0] = str.charCodeAt(i[0]);
				return new Value.ptr(uint8Type, (c.$ptr || (c.$ptr = new ptrType$5(function() { return this.$target[0]; }, function($v) { this.$target[0] = $v; }, c))), (fl$2 | 128) >>> 0);
			/* } else { */ case 5:
				$panic(new ValueError.ptr("reflect.Value.Index", k));
			/* } */ case 6:
		case 1:
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.Index }; } $f.$ptr = $ptr; $f._13 = _13; $f._r = _r; $f._r$1 = _r$1; $f.a = a; $f.a$1 = a$1; $f.c = c; $f.fl = fl; $f.fl$1 = fl$1; $f.fl$2 = fl$2; $f.i = i; $f.k = k; $f.s = s; $f.str = str; $f.tt = tt; $f.tt$1 = tt$1; $f.typ = typ; $f.typ$1 = typ$1; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.Index = function(i) { return this.$val.Index(i); };
	Value.ptr.prototype.InterfaceData = function() {
		var $ptr, v;
		v = this;
		$panic(errors.New("InterfaceData is not supported by GopherJS"));
	};
	Value.prototype.InterfaceData = function() { return this.$val.InterfaceData(); };
	Value.ptr.prototype.IsNil = function() {
		var $ptr, _14, k, v;
		v = this;
		k = new flag(v.flag).kind();
		_14 = k;
		if ((_14 === 22) || (_14 === 23)) {
			return v.object() === jsType(v.typ).nil;
		} else if (_14 === 18) {
			return v.object() === $chanNil;
		} else if (_14 === 19) {
			return v.object() === $throwNilPointerError;
		} else if (_14 === 21) {
			return v.object() === false;
		} else if (_14 === 20) {
			return v.object() === $ifaceNil;
		} else {
			$panic(new ValueError.ptr("reflect.Value.IsNil", k));
		}
	};
	Value.prototype.IsNil = function() { return this.$val.IsNil(); };
	Value.ptr.prototype.Len = function() {
		var $ptr, _15, k, v;
		v = this;
		k = new flag(v.flag).kind();
		_15 = k;
		if ((_15 === 17) || (_15 === 24)) {
			return $parseInt(v.object().length);
		} else if (_15 === 23) {
			return $parseInt(v.object().$length) >> 0;
		} else if (_15 === 18) {
			return $parseInt(v.object().$buffer.length) >> 0;
		} else if (_15 === 21) {
			return $parseInt($keys(v.object()).length);
		} else {
			$panic(new ValueError.ptr("reflect.Value.Len", k));
		}
	};
	Value.prototype.Len = function() { return this.$val.Len(); };
	Value.ptr.prototype.Pointer = function() {
		var $ptr, _16, k, v;
		v = this;
		k = new flag(v.flag).kind();
		_16 = k;
		if ((_16 === 18) || (_16 === 21) || (_16 === 22) || (_16 === 26)) {
			if (v.IsNil()) {
				return 0;
			}
			return v.object();
		} else if (_16 === 19) {
			if (v.IsNil()) {
				return 0;
			}
			return 1;
		} else if (_16 === 23) {
			if (v.IsNil()) {
				return 0;
			}
			return v.object().$array;
		} else {
			$panic(new ValueError.ptr("reflect.Value.Pointer", k));
		}
	};
	Value.prototype.Pointer = function() { return this.$val.Pointer(); };
	Value.ptr.prototype.Set = function(x) {
		var $ptr, _17, _r, _r$1, v, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _17 = $f._17; _r = $f._r; _r$1 = $f._r$1; v = $f.v; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		x = x;
		v = this;
		new flag(v.flag).mustBeAssignable();
		new flag(x.flag).mustBeExported();
		_r = x.assignTo("reflect.Set", v.typ, 0); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		x = _r;
		/* */ if (!((((v.flag & 128) >>> 0) === 0))) { $s = 2; continue; }
		/* */ $s = 3; continue;
		/* if (!((((v.flag & 128) >>> 0) === 0))) { */ case 2:
				_17 = v.typ.Kind();
				/* */ if (_17 === 17) { $s = 5; continue; }
				/* */ if (_17 === 20) { $s = 6; continue; }
				/* */ if (_17 === 25) { $s = 7; continue; }
				/* */ $s = 8; continue;
				/* if (_17 === 17) { */ case 5:
					jsType(v.typ).copy(v.ptr, x.ptr);
					$s = 9; continue;
				/* } else if (_17 === 20) { */ case 6:
					_r$1 = valueInterface(x, false); /* */ $s = 10; case 10: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
					v.ptr.$set(_r$1);
					$s = 9; continue;
				/* } else if (_17 === 25) { */ case 7:
					copyStruct(v.ptr, x.ptr, v.typ);
					$s = 9; continue;
				/* } else { */ case 8:
					v.ptr.$set(x.object());
				/* } */ case 9:
			case 4:
			return;
		/* } */ case 3:
		v.ptr = x.ptr;
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.Set }; } $f.$ptr = $ptr; $f._17 = _17; $f._r = _r; $f._r$1 = _r$1; $f.v = v; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.Set = function(x) { return this.$val.Set(x); };
	Value.ptr.prototype.SetBytes = function(x) {
		var $ptr, _r, _r$1, _v, slice, typedSlice, v, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _v = $f._v; slice = $f.slice; typedSlice = $f.typedSlice; v = $f.v; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		new flag(v.flag).mustBeAssignable();
		new flag(v.flag).mustBe(23);
		_r = v.typ.Elem().Kind(); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ if (!((_r === 8))) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!((_r === 8))) { */ case 1:
			$panic(new $String("reflect.Value.SetBytes of non-byte slice"));
		/* } */ case 2:
		slice = x;
		if (!(v.typ.Name() === "")) { _v = true; $s = 6; continue s; }
		_r$1 = v.typ.Elem().Name(); /* */ $s = 7; case 7: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_v = !(_r$1 === ""); case 6:
		/* */ if (_v) { $s = 4; continue; }
		/* */ $s = 5; continue;
		/* if (_v) { */ case 4:
			typedSlice = new (jsType(v.typ))(slice.$array);
			typedSlice.$offset = slice.$offset;
			typedSlice.$length = slice.$length;
			typedSlice.$capacity = slice.$capacity;
			slice = typedSlice;
		/* } */ case 5:
		v.ptr.$set(slice);
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.SetBytes }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._v = _v; $f.slice = slice; $f.typedSlice = typedSlice; $f.v = v; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.SetBytes = function(x) { return this.$val.SetBytes(x); };
	Value.ptr.prototype.SetCap = function(n) {
		var $ptr, n, newSlice, s, v;
		v = this;
		new flag(v.flag).mustBeAssignable();
		new flag(v.flag).mustBe(23);
		s = v.ptr.$get();
		if (n < ($parseInt(s.$length) >> 0) || n > ($parseInt(s.$capacity) >> 0)) {
			$panic(new $String("reflect: slice capacity out of range in SetCap"));
		}
		newSlice = new (jsType(v.typ))(s.$array);
		newSlice.$offset = s.$offset;
		newSlice.$length = s.$length;
		newSlice.$capacity = n;
		v.ptr.$set(newSlice);
	};
	Value.prototype.SetCap = function(n) { return this.$val.SetCap(n); };
	Value.ptr.prototype.SetLen = function(n) {
		var $ptr, n, newSlice, s, v;
		v = this;
		new flag(v.flag).mustBeAssignable();
		new flag(v.flag).mustBe(23);
		s = v.ptr.$get();
		if (n < 0 || n > ($parseInt(s.$capacity) >> 0)) {
			$panic(new $String("reflect: slice length out of range in SetLen"));
		}
		newSlice = new (jsType(v.typ))(s.$array);
		newSlice.$offset = s.$offset;
		newSlice.$length = n;
		newSlice.$capacity = s.$capacity;
		v.ptr.$set(newSlice);
	};
	Value.prototype.SetLen = function(n) { return this.$val.SetLen(n); };
	Value.ptr.prototype.Slice = function(i, j) {
		var $ptr, _18, _r, _r$1, cap, i, j, kind, s, str, tt, typ, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _18 = $f._18; _r = $f._r; _r$1 = $f._r$1; cap = $f.cap; i = $f.i; j = $f.j; kind = $f.kind; s = $f.s; str = $f.str; tt = $f.tt; typ = $f.typ; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		cap = 0;
		typ = $ifaceNil;
		s = null;
			kind = new flag(v.flag).kind();
			_18 = kind;
			/* */ if (_18 === 17) { $s = 2; continue; }
			/* */ if (_18 === 23) { $s = 3; continue; }
			/* */ if (_18 === 24) { $s = 4; continue; }
			/* */ $s = 5; continue;
			/* if (_18 === 17) { */ case 2:
				if (((v.flag & 256) >>> 0) === 0) {
					$panic(new $String("reflect.Value.Slice: slice of unaddressable array"));
				}
				tt = v.typ.kindType;
				cap = (tt.len >> 0);
				typ = SliceOf(tt.elem);
				s = new (jsType(typ))(v.object());
				$s = 6; continue;
			/* } else if (_18 === 23) { */ case 3:
				typ = v.typ;
				s = v.object();
				cap = $parseInt(s.$capacity) >> 0;
				$s = 6; continue;
			/* } else if (_18 === 24) { */ case 4:
				str = v.ptr.$get();
				if (i < 0 || j < i || j > str.length) {
					$panic(new $String("reflect.Value.Slice: string slice index out of bounds"));
				}
				_r = ValueOf(new $String(str.substring(i, j))); /* */ $s = 7; case 7: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				/* */ $s = 8; case 8:
				return _r;
			/* } else { */ case 5:
				$panic(new ValueError.ptr("reflect.Value.Slice", kind));
			/* } */ case 6:
		case 1:
		if (i < 0 || j < i || j > cap) {
			$panic(new $String("reflect.Value.Slice: slice index out of bounds"));
		}
		_r$1 = makeValue(typ, $subslice(s, i, j), (v.flag & 96) >>> 0); /* */ $s = 9; case 9: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		/* */ $s = 10; case 10:
		return _r$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.Slice }; } $f.$ptr = $ptr; $f._18 = _18; $f._r = _r; $f._r$1 = _r$1; $f.cap = cap; $f.i = i; $f.j = j; $f.kind = kind; $f.s = s; $f.str = str; $f.tt = tt; $f.typ = typ; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.Slice = function(i, j) { return this.$val.Slice(i, j); };
	Value.ptr.prototype.Slice3 = function(i, j, k) {
		var $ptr, _19, _r, cap, i, j, k, kind, s, tt, typ, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _19 = $f._19; _r = $f._r; cap = $f.cap; i = $f.i; j = $f.j; k = $f.k; kind = $f.kind; s = $f.s; tt = $f.tt; typ = $f.typ; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		cap = 0;
		typ = $ifaceNil;
		s = null;
		kind = new flag(v.flag).kind();
		_19 = kind;
		if (_19 === 17) {
			if (((v.flag & 256) >>> 0) === 0) {
				$panic(new $String("reflect.Value.Slice: slice of unaddressable array"));
			}
			tt = v.typ.kindType;
			cap = (tt.len >> 0);
			typ = SliceOf(tt.elem);
			s = new (jsType(typ))(v.object());
		} else if (_19 === 23) {
			typ = v.typ;
			s = v.object();
			cap = $parseInt(s.$capacity) >> 0;
		} else {
			$panic(new ValueError.ptr("reflect.Value.Slice3", kind));
		}
		if (i < 0 || j < i || k < j || k > cap) {
			$panic(new $String("reflect.Value.Slice3: slice index out of bounds"));
		}
		_r = makeValue(typ, $subslice(s, i, j, k), (v.flag & 96) >>> 0); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.Slice3 }; } $f.$ptr = $ptr; $f._19 = _19; $f._r = _r; $f.cap = cap; $f.i = i; $f.j = j; $f.k = k; $f.kind = kind; $f.s = s; $f.tt = tt; $f.typ = typ; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.Slice3 = function(i, j, k) { return this.$val.Slice3(i, j, k); };
	Value.ptr.prototype.Close = function() {
		var $ptr, v;
		v = this;
		new flag(v.flag).mustBe(18);
		new flag(v.flag).mustBeExported();
		$close(v.object());
	};
	Value.prototype.Close = function() { return this.$val.Close(); };
	chanrecv = function(t, ch, nb, val) {
		var $ptr, _r, _tmp, _tmp$1, _tmp$2, _tmp$3, ch, comms, nb, received, recvRes, selectRes, selected, t, val, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tmp$2 = $f._tmp$2; _tmp$3 = $f._tmp$3; ch = $f.ch; comms = $f.comms; nb = $f.nb; received = $f.received; recvRes = $f.recvRes; selectRes = $f.selectRes; selected = $f.selected; t = $f.t; val = $f.val; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		selected = false;
		received = false;
		comms = new sliceType$9([new sliceType$7([ch])]);
		if (nb) {
			comms = $append(comms, new sliceType$7([]));
		}
		_r = selectHelper(new sliceType$2([comms])); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		selectRes = _r;
		if (nb && (($parseInt(selectRes[0]) >> 0) === 1)) {
			_tmp = false;
			_tmp$1 = false;
			selected = _tmp;
			received = _tmp$1;
			return [selected, received];
		}
		recvRes = selectRes[1];
		val.$set(recvRes[0]);
		_tmp$2 = true;
		_tmp$3 = !!(recvRes[1]);
		selected = _tmp$2;
		received = _tmp$3;
		return [selected, received];
		/* */ } return; } if ($f === undefined) { $f = { $blk: chanrecv }; } $f.$ptr = $ptr; $f._r = _r; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tmp$2 = _tmp$2; $f._tmp$3 = _tmp$3; $f.ch = ch; $f.comms = comms; $f.nb = nb; $f.received = received; $f.recvRes = recvRes; $f.selectRes = selectRes; $f.selected = selected; $f.t = t; $f.val = val; $f.$s = $s; $f.$r = $r; return $f;
	};
	chansend = function(t, ch, val, nb) {
		var $ptr, _r, ch, comms, nb, selectRes, t, val, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; ch = $f.ch; comms = $f.comms; nb = $f.nb; selectRes = $f.selectRes; t = $f.t; val = $f.val; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		comms = new sliceType$9([new sliceType$7([ch, val.$get()])]);
		if (nb) {
			comms = $append(comms, new sliceType$7([]));
		}
		_r = selectHelper(new sliceType$2([comms])); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		selectRes = _r;
		if (nb && (($parseInt(selectRes[0]) >> 0) === 1)) {
			return false;
		}
		return true;
		/* */ } return; } if ($f === undefined) { $f = { $blk: chansend }; } $f.$ptr = $ptr; $f._r = _r; $f.ch = ch; $f.comms = comms; $f.nb = nb; $f.selectRes = selectRes; $f.t = t; $f.val = val; $f.$s = $s; $f.$r = $r; return $f;
	};
	DeepEqual = function(a1, a2) {
		var $ptr, _arg, _arg$1, _arg$2, _r, _r$1, _r$2, a1, a2, i1, i2, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _arg = $f._arg; _arg$1 = $f._arg$1; _arg$2 = $f._arg$2; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; a1 = $f.a1; a2 = $f.a2; i1 = $f.i1; i2 = $f.i2; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		i1 = a1;
		i2 = a2;
		if (i1 === i2) {
			return true;
		}
		if (i1 === null || i2 === null || !(i1.constructor === i2.constructor)) {
			return false;
		}
		_r = ValueOf(a1); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_arg = _r;
		_r$1 = ValueOf(a2); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_arg$1 = _r$1;
		_arg$2 = sliceType$10.nil;
		_r$2 = deepValueEqualJs(_arg, _arg$1, _arg$2); /* */ $s = 3; case 3: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		/* */ $s = 4; case 4:
		return _r$2;
		/* */ } return; } if ($f === undefined) { $f = { $blk: DeepEqual }; } $f.$ptr = $ptr; $f._arg = _arg; $f._arg$1 = _arg$1; $f._arg$2 = _arg$2; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f.a1 = a1; $f.a2 = a2; $f.i1 = i1; $f.i2 = i2; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.DeepEqual = DeepEqual;
	deepValueEqualJs = function(v1, v2, visited) {
		var $ptr, _21, _22, _arg, _arg$1, _arg$10, _arg$11, _arg$2, _arg$3, _arg$4, _arg$5, _arg$6, _arg$7, _arg$8, _arg$9, _i, _i$1, _r, _r$1, _r$10, _r$11, _r$12, _r$13, _r$14, _r$15, _r$16, _r$17, _r$2, _r$3, _r$4, _r$5, _r$6, _r$7, _r$8, _r$9, _ref, _ref$1, _v, entry, i, i$1, k, keys, n, n$1, v1, v2, val1, val2, visited, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _21 = $f._21; _22 = $f._22; _arg = $f._arg; _arg$1 = $f._arg$1; _arg$10 = $f._arg$10; _arg$11 = $f._arg$11; _arg$2 = $f._arg$2; _arg$3 = $f._arg$3; _arg$4 = $f._arg$4; _arg$5 = $f._arg$5; _arg$6 = $f._arg$6; _arg$7 = $f._arg$7; _arg$8 = $f._arg$8; _arg$9 = $f._arg$9; _i = $f._i; _i$1 = $f._i$1; _r = $f._r; _r$1 = $f._r$1; _r$10 = $f._r$10; _r$11 = $f._r$11; _r$12 = $f._r$12; _r$13 = $f._r$13; _r$14 = $f._r$14; _r$15 = $f._r$15; _r$16 = $f._r$16; _r$17 = $f._r$17; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; _r$5 = $f._r$5; _r$6 = $f._r$6; _r$7 = $f._r$7; _r$8 = $f._r$8; _r$9 = $f._r$9; _ref = $f._ref; _ref$1 = $f._ref$1; _v = $f._v; entry = $f.entry; i = $f.i; i$1 = $f.i$1; k = $f.k; keys = $f.keys; n = $f.n; n$1 = $f.n$1; v1 = $f.v1; v2 = $f.v2; val1 = $f.val1; val2 = $f.val2; visited = $f.visited; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v2 = v2;
		v1 = v1;
		if (!v1.IsValid() || !v2.IsValid()) {
			return !v1.IsValid() && !v2.IsValid();
		}
		if (!($interfaceIsEqual(v1.Type(), v2.Type()))) {
			return false;
		}
		_21 = v1.Kind();
		if ((_21 === 17) || (_21 === 21) || (_21 === 23) || (_21 === 25)) {
			_ref = visited;
			_i = 0;
			while (true) {
				if (!(_i < _ref.$length)) { break; }
				entry = $clone(((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]), arrayType$2);
				if (v1.ptr === entry[0] && v2.ptr === entry[1]) {
					return true;
				}
				_i++;
			}
			visited = $append(visited, $toNativeArray($kindUnsafePointer, [v1.ptr, v2.ptr]));
		}
			_22 = v1.Kind();
			/* */ if ((_22 === 17) || (_22 === 23)) { $s = 2; continue; }
			/* */ if (_22 === 20) { $s = 3; continue; }
			/* */ if (_22 === 22) { $s = 4; continue; }
			/* */ if (_22 === 25) { $s = 5; continue; }
			/* */ if (_22 === 21) { $s = 6; continue; }
			/* */ if (_22 === 19) { $s = 7; continue; }
			/* */ if (_22 === 26) { $s = 8; continue; }
			/* */ $s = 9; continue;
			/* if ((_22 === 17) || (_22 === 23)) { */ case 2:
				if (v1.Kind() === 23) {
					if (!(v1.IsNil() === v2.IsNil())) {
						return false;
					}
					if (v1.object() === v2.object()) {
						return true;
					}
				}
				n = v1.Len();
				if (!((n === v2.Len()))) {
					return false;
				}
				i = 0;
				/* while (true) { */ case 10:
					/* if (!(i < n)) { break; } */ if(!(i < n)) { $s = 11; continue; }
					_r = v1.Index(i); /* */ $s = 14; case 14: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
					_arg = _r;
					_r$1 = v2.Index(i); /* */ $s = 15; case 15: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
					_arg$1 = _r$1;
					_arg$2 = visited;
					_r$2 = deepValueEqualJs(_arg, _arg$1, _arg$2); /* */ $s = 16; case 16: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
					/* */ if (!_r$2) { $s = 12; continue; }
					/* */ $s = 13; continue;
					/* if (!_r$2) { */ case 12:
						return false;
					/* } */ case 13:
					i = i + (1) >> 0;
				/* } */ $s = 10; continue; case 11:
				return true;
			/* } else if (_22 === 20) { */ case 3:
				if (v1.IsNil() || v2.IsNil()) {
					return v1.IsNil() && v2.IsNil();
				}
				_r$3 = v1.Elem(); /* */ $s = 17; case 17: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
				_arg$3 = _r$3;
				_r$4 = v2.Elem(); /* */ $s = 18; case 18: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
				_arg$4 = _r$4;
				_arg$5 = visited;
				_r$5 = deepValueEqualJs(_arg$3, _arg$4, _arg$5); /* */ $s = 19; case 19: if($c) { $c = false; _r$5 = _r$5.$blk(); } if (_r$5 && _r$5.$blk !== undefined) { break s; }
				/* */ $s = 20; case 20:
				return _r$5;
			/* } else if (_22 === 22) { */ case 4:
				_r$6 = v1.Elem(); /* */ $s = 21; case 21: if($c) { $c = false; _r$6 = _r$6.$blk(); } if (_r$6 && _r$6.$blk !== undefined) { break s; }
				_arg$6 = _r$6;
				_r$7 = v2.Elem(); /* */ $s = 22; case 22: if($c) { $c = false; _r$7 = _r$7.$blk(); } if (_r$7 && _r$7.$blk !== undefined) { break s; }
				_arg$7 = _r$7;
				_arg$8 = visited;
				_r$8 = deepValueEqualJs(_arg$6, _arg$7, _arg$8); /* */ $s = 23; case 23: if($c) { $c = false; _r$8 = _r$8.$blk(); } if (_r$8 && _r$8.$blk !== undefined) { break s; }
				/* */ $s = 24; case 24:
				return _r$8;
			/* } else if (_22 === 25) { */ case 5:
				n$1 = v1.NumField();
				i$1 = 0;
				/* while (true) { */ case 25:
					/* if (!(i$1 < n$1)) { break; } */ if(!(i$1 < n$1)) { $s = 26; continue; }
					_r$9 = v1.Field(i$1); /* */ $s = 29; case 29: if($c) { $c = false; _r$9 = _r$9.$blk(); } if (_r$9 && _r$9.$blk !== undefined) { break s; }
					_arg$9 = _r$9;
					_r$10 = v2.Field(i$1); /* */ $s = 30; case 30: if($c) { $c = false; _r$10 = _r$10.$blk(); } if (_r$10 && _r$10.$blk !== undefined) { break s; }
					_arg$10 = _r$10;
					_arg$11 = visited;
					_r$11 = deepValueEqualJs(_arg$9, _arg$10, _arg$11); /* */ $s = 31; case 31: if($c) { $c = false; _r$11 = _r$11.$blk(); } if (_r$11 && _r$11.$blk !== undefined) { break s; }
					/* */ if (!_r$11) { $s = 27; continue; }
					/* */ $s = 28; continue;
					/* if (!_r$11) { */ case 27:
						return false;
					/* } */ case 28:
					i$1 = i$1 + (1) >> 0;
				/* } */ $s = 25; continue; case 26:
				return true;
			/* } else if (_22 === 21) { */ case 6:
				if (!(v1.IsNil() === v2.IsNil())) {
					return false;
				}
				if (v1.object() === v2.object()) {
					return true;
				}
				_r$12 = v1.MapKeys(); /* */ $s = 32; case 32: if($c) { $c = false; _r$12 = _r$12.$blk(); } if (_r$12 && _r$12.$blk !== undefined) { break s; }
				keys = _r$12;
				if (!((keys.$length === v2.Len()))) {
					return false;
				}
				_ref$1 = keys;
				_i$1 = 0;
				/* while (true) { */ case 33:
					/* if (!(_i$1 < _ref$1.$length)) { break; } */ if(!(_i$1 < _ref$1.$length)) { $s = 34; continue; }
					k = ((_i$1 < 0 || _i$1 >= _ref$1.$length) ? $throwRuntimeError("index out of range") : _ref$1.$array[_ref$1.$offset + _i$1]);
					_r$13 = v1.MapIndex(k); /* */ $s = 35; case 35: if($c) { $c = false; _r$13 = _r$13.$blk(); } if (_r$13 && _r$13.$blk !== undefined) { break s; }
					val1 = _r$13;
					_r$14 = v2.MapIndex(k); /* */ $s = 36; case 36: if($c) { $c = false; _r$14 = _r$14.$blk(); } if (_r$14 && _r$14.$blk !== undefined) { break s; }
					val2 = _r$14;
					if (!val1.IsValid() || !val2.IsValid()) { _v = true; $s = 39; continue s; }
					_r$15 = deepValueEqualJs(val1, val2, visited); /* */ $s = 40; case 40: if($c) { $c = false; _r$15 = _r$15.$blk(); } if (_r$15 && _r$15.$blk !== undefined) { break s; }
					_v = !_r$15; case 39:
					/* */ if (_v) { $s = 37; continue; }
					/* */ $s = 38; continue;
					/* if (_v) { */ case 37:
						return false;
					/* } */ case 38:
					_i$1++;
				/* } */ $s = 33; continue; case 34:
				return true;
			/* } else if (_22 === 19) { */ case 7:
				return v1.IsNil() && v2.IsNil();
			/* } else if (_22 === 26) { */ case 8:
				return v1.object() === v2.object();
			/* } */ case 9:
		case 1:
		_r$16 = valueInterface(v1, false); /* */ $s = 41; case 41: if($c) { $c = false; _r$16 = _r$16.$blk(); } if (_r$16 && _r$16.$blk !== undefined) { break s; }
		_r$17 = valueInterface(v2, false); /* */ $s = 42; case 42: if($c) { $c = false; _r$17 = _r$17.$blk(); } if (_r$17 && _r$17.$blk !== undefined) { break s; }
		/* */ $s = 43; case 43:
		return !!($interfaceIsEqual(_r$16, _r$17));
		/* */ } return; } if ($f === undefined) { $f = { $blk: deepValueEqualJs }; } $f.$ptr = $ptr; $f._21 = _21; $f._22 = _22; $f._arg = _arg; $f._arg$1 = _arg$1; $f._arg$10 = _arg$10; $f._arg$11 = _arg$11; $f._arg$2 = _arg$2; $f._arg$3 = _arg$3; $f._arg$4 = _arg$4; $f._arg$5 = _arg$5; $f._arg$6 = _arg$6; $f._arg$7 = _arg$7; $f._arg$8 = _arg$8; $f._arg$9 = _arg$9; $f._i = _i; $f._i$1 = _i$1; $f._r = _r; $f._r$1 = _r$1; $f._r$10 = _r$10; $f._r$11 = _r$11; $f._r$12 = _r$12; $f._r$13 = _r$13; $f._r$14 = _r$14; $f._r$15 = _r$15; $f._r$16 = _r$16; $f._r$17 = _r$17; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._r$5 = _r$5; $f._r$6 = _r$6; $f._r$7 = _r$7; $f._r$8 = _r$8; $f._r$9 = _r$9; $f._ref = _ref; $f._ref$1 = _ref$1; $f._v = _v; $f.entry = entry; $f.i = i; $f.i$1 = i$1; $f.k = k; $f.keys = keys; $f.n = n; $f.n$1 = n$1; $f.v1 = v1; $f.v2 = v2; $f.val1 = val1; $f.val2 = val2; $f.visited = visited; $f.$s = $s; $f.$r = $r; return $f;
	};
	Kind.prototype.String = function() {
		var $ptr, k;
		k = this.$val;
		if ((k >> 0) < kindNames.$length) {
			return ((k < 0 || k >= kindNames.$length) ? $throwRuntimeError("index out of range") : kindNames.$array[kindNames.$offset + k]);
		}
		return "kind" + strconv.Itoa((k >> 0));
	};
	$ptrType(Kind).prototype.String = function() { return new Kind(this.$get()).String(); };
	uncommonType.ptr.prototype.uncommon = function() {
		var $ptr, t;
		t = this;
		return t;
	};
	uncommonType.prototype.uncommon = function() { return this.$val.uncommon(); };
	uncommonType.ptr.prototype.PkgPath = function() {
		var $ptr, t;
		t = this;
		if (t === ptrType$7.nil || t.pkgPath === ptrType$6.nil) {
			return "";
		}
		return t.pkgPath.$get();
	};
	uncommonType.prototype.PkgPath = function() { return this.$val.PkgPath(); };
	uncommonType.ptr.prototype.Name = function() {
		var $ptr, t;
		t = this;
		if (t === ptrType$7.nil || t.name === ptrType$6.nil) {
			return "";
		}
		return t.name.$get();
	};
	uncommonType.prototype.Name = function() { return this.$val.Name(); };
	rtype.ptr.prototype.String = function() {
		var $ptr, t;
		t = this;
		return t.string.$get();
	};
	rtype.prototype.String = function() { return this.$val.String(); };
	rtype.ptr.prototype.Size = function() {
		var $ptr, t;
		t = this;
		return t.size;
	};
	rtype.prototype.Size = function() { return this.$val.Size(); };
	rtype.ptr.prototype.Bits = function() {
		var $ptr, k, t;
		t = this;
		if (t === ptrType$1.nil) {
			$panic(new $String("reflect: Bits of nil Type"));
		}
		k = t.Kind();
		if (k < 2 || k > 16) {
			$panic(new $String("reflect: Bits of non-arithmetic Type " + t.String()));
		}
		return $imul((t.size >> 0), 8);
	};
	rtype.prototype.Bits = function() { return this.$val.Bits(); };
	rtype.ptr.prototype.Align = function() {
		var $ptr, t;
		t = this;
		return (t.align >> 0);
	};
	rtype.prototype.Align = function() { return this.$val.Align(); };
	rtype.ptr.prototype.FieldAlign = function() {
		var $ptr, t;
		t = this;
		return (t.fieldAlign >> 0);
	};
	rtype.prototype.FieldAlign = function() { return this.$val.FieldAlign(); };
	rtype.ptr.prototype.Kind = function() {
		var $ptr, t;
		t = this;
		return (((t.kind & 31) >>> 0) >>> 0);
	};
	rtype.prototype.Kind = function() { return this.$val.Kind(); };
	rtype.ptr.prototype.common = function() {
		var $ptr, t;
		t = this;
		return t;
	};
	rtype.prototype.common = function() { return this.$val.common(); };
	uncommonType.ptr.prototype.NumMethod = function() {
		var $ptr, t;
		t = this;
		if (t === ptrType$7.nil) {
			return 0;
		}
		return t.methods.$length;
	};
	uncommonType.prototype.NumMethod = function() { return this.$val.NumMethod(); };
	uncommonType.ptr.prototype.MethodByName = function(name) {
		var $ptr, _i, _ref, _tmp, _tmp$1, i, m, name, ok, p, t, x;
		m = new Method.ptr("", "", $ifaceNil, new Value.ptr(ptrType$1.nil, 0, 0), 0);
		ok = false;
		t = this;
		if (t === ptrType$7.nil) {
			return [m, ok];
		}
		p = ptrType$10.nil;
		_ref = t.methods;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			i = _i;
			p = (x = t.methods, ((i < 0 || i >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + i]));
			if (!(p.name === ptrType$6.nil) && p.name.$get() === name) {
				_tmp = $clone(t.Method(i), Method);
				_tmp$1 = true;
				Method.copy(m, _tmp);
				ok = _tmp$1;
				return [m, ok];
			}
			_i++;
		}
		return [m, ok];
	};
	uncommonType.prototype.MethodByName = function(name) { return this.$val.MethodByName(name); };
	rtype.ptr.prototype.NumMethod = function() {
		var $ptr, t, tt;
		t = this;
		if (t.Kind() === 20) {
			tt = t.kindType;
			return tt.NumMethod();
		}
		return t.uncommonType.NumMethod();
	};
	rtype.prototype.NumMethod = function() { return this.$val.NumMethod(); };
	rtype.ptr.prototype.Method = function(i) {
		var $ptr, i, m, t, tt;
		m = new Method.ptr("", "", $ifaceNil, new Value.ptr(ptrType$1.nil, 0, 0), 0);
		t = this;
		if (t.Kind() === 20) {
			tt = t.kindType;
			Method.copy(m, tt.Method(i));
			return m;
		}
		Method.copy(m, t.uncommonType.Method(i));
		return m;
	};
	rtype.prototype.Method = function(i) { return this.$val.Method(i); };
	rtype.ptr.prototype.MethodByName = function(name) {
		var $ptr, _tuple, _tuple$1, m, name, ok, t, tt;
		m = new Method.ptr("", "", $ifaceNil, new Value.ptr(ptrType$1.nil, 0, 0), 0);
		ok = false;
		t = this;
		if (t.Kind() === 20) {
			tt = t.kindType;
			_tuple = tt.MethodByName(name);
			Method.copy(m, _tuple[0]);
			ok = _tuple[1];
			return [m, ok];
		}
		_tuple$1 = t.uncommonType.MethodByName(name);
		Method.copy(m, _tuple$1[0]);
		ok = _tuple$1[1];
		return [m, ok];
	};
	rtype.prototype.MethodByName = function(name) { return this.$val.MethodByName(name); };
	rtype.ptr.prototype.PkgPath = function() {
		var $ptr, t;
		t = this;
		return t.uncommonType.PkgPath();
	};
	rtype.prototype.PkgPath = function() { return this.$val.PkgPath(); };
	rtype.ptr.prototype.Name = function() {
		var $ptr, t;
		t = this;
		return t.uncommonType.Name();
	};
	rtype.prototype.Name = function() { return this.$val.Name(); };
	rtype.ptr.prototype.ChanDir = function() {
		var $ptr, t, tt;
		t = this;
		if (!((t.Kind() === 18))) {
			$panic(new $String("reflect: ChanDir of non-chan type"));
		}
		tt = t.kindType;
		return (tt.dir >> 0);
	};
	rtype.prototype.ChanDir = function() { return this.$val.ChanDir(); };
	rtype.ptr.prototype.IsVariadic = function() {
		var $ptr, t, tt;
		t = this;
		if (!((t.Kind() === 19))) {
			$panic(new $String("reflect: IsVariadic of non-func type"));
		}
		tt = t.kindType;
		return tt.dotdotdot;
	};
	rtype.prototype.IsVariadic = function() { return this.$val.IsVariadic(); };
	rtype.ptr.prototype.Elem = function() {
		var $ptr, _1, t, tt, tt$1, tt$2, tt$3, tt$4;
		t = this;
		_1 = t.Kind();
		if (_1 === 17) {
			tt = t.kindType;
			return toType(tt.elem);
		} else if (_1 === 18) {
			tt$1 = t.kindType;
			return toType(tt$1.elem);
		} else if (_1 === 21) {
			tt$2 = t.kindType;
			return toType(tt$2.elem);
		} else if (_1 === 22) {
			tt$3 = t.kindType;
			return toType(tt$3.elem);
		} else if (_1 === 23) {
			tt$4 = t.kindType;
			return toType(tt$4.elem);
		}
		$panic(new $String("reflect: Elem of invalid type"));
	};
	rtype.prototype.Elem = function() { return this.$val.Elem(); };
	rtype.ptr.prototype.Field = function(i) {
		var $ptr, _r, i, t, tt, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; i = $f.i; t = $f.t; tt = $f.tt; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		if (!((t.Kind() === 25))) {
			$panic(new $String("reflect: Field of non-struct type"));
		}
		tt = t.kindType;
		_r = tt.Field(i); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: rtype.ptr.prototype.Field }; } $f.$ptr = $ptr; $f._r = _r; $f.i = i; $f.t = t; $f.tt = tt; $f.$s = $s; $f.$r = $r; return $f;
	};
	rtype.prototype.Field = function(i) { return this.$val.Field(i); };
	rtype.ptr.prototype.FieldByIndex = function(index) {
		var $ptr, _r, index, t, tt, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; index = $f.index; t = $f.t; tt = $f.tt; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		if (!((t.Kind() === 25))) {
			$panic(new $String("reflect: FieldByIndex of non-struct type"));
		}
		tt = t.kindType;
		_r = tt.FieldByIndex(index); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: rtype.ptr.prototype.FieldByIndex }; } $f.$ptr = $ptr; $f._r = _r; $f.index = index; $f.t = t; $f.tt = tt; $f.$s = $s; $f.$r = $r; return $f;
	};
	rtype.prototype.FieldByIndex = function(index) { return this.$val.FieldByIndex(index); };
	rtype.ptr.prototype.FieldByName = function(name) {
		var $ptr, _r, name, t, tt, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; name = $f.name; t = $f.t; tt = $f.tt; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		if (!((t.Kind() === 25))) {
			$panic(new $String("reflect: FieldByName of non-struct type"));
		}
		tt = t.kindType;
		_r = tt.FieldByName(name); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: rtype.ptr.prototype.FieldByName }; } $f.$ptr = $ptr; $f._r = _r; $f.name = name; $f.t = t; $f.tt = tt; $f.$s = $s; $f.$r = $r; return $f;
	};
	rtype.prototype.FieldByName = function(name) { return this.$val.FieldByName(name); };
	rtype.ptr.prototype.FieldByNameFunc = function(match) {
		var $ptr, _r, match, t, tt, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; match = $f.match; t = $f.t; tt = $f.tt; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		if (!((t.Kind() === 25))) {
			$panic(new $String("reflect: FieldByNameFunc of non-struct type"));
		}
		tt = t.kindType;
		_r = tt.FieldByNameFunc(match); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: rtype.ptr.prototype.FieldByNameFunc }; } $f.$ptr = $ptr; $f._r = _r; $f.match = match; $f.t = t; $f.tt = tt; $f.$s = $s; $f.$r = $r; return $f;
	};
	rtype.prototype.FieldByNameFunc = function(match) { return this.$val.FieldByNameFunc(match); };
	rtype.ptr.prototype.In = function(i) {
		var $ptr, i, t, tt, x;
		t = this;
		if (!((t.Kind() === 19))) {
			$panic(new $String("reflect: In of non-func type"));
		}
		tt = t.kindType;
		return toType((x = tt.in$2, ((i < 0 || i >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + i])));
	};
	rtype.prototype.In = function(i) { return this.$val.In(i); };
	rtype.ptr.prototype.Key = function() {
		var $ptr, t, tt;
		t = this;
		if (!((t.Kind() === 21))) {
			$panic(new $String("reflect: Key of non-map type"));
		}
		tt = t.kindType;
		return toType(tt.key);
	};
	rtype.prototype.Key = function() { return this.$val.Key(); };
	rtype.ptr.prototype.Len = function() {
		var $ptr, t, tt;
		t = this;
		if (!((t.Kind() === 17))) {
			$panic(new $String("reflect: Len of non-array type"));
		}
		tt = t.kindType;
		return (tt.len >> 0);
	};
	rtype.prototype.Len = function() { return this.$val.Len(); };
	rtype.ptr.prototype.NumField = function() {
		var $ptr, t, tt;
		t = this;
		if (!((t.Kind() === 25))) {
			$panic(new $String("reflect: NumField of non-struct type"));
		}
		tt = t.kindType;
		return tt.fields.$length;
	};
	rtype.prototype.NumField = function() { return this.$val.NumField(); };
	rtype.ptr.prototype.NumIn = function() {
		var $ptr, t, tt;
		t = this;
		if (!((t.Kind() === 19))) {
			$panic(new $String("reflect: NumIn of non-func type"));
		}
		tt = t.kindType;
		return tt.in$2.$length;
	};
	rtype.prototype.NumIn = function() { return this.$val.NumIn(); };
	rtype.ptr.prototype.NumOut = function() {
		var $ptr, t, tt;
		t = this;
		if (!((t.Kind() === 19))) {
			$panic(new $String("reflect: NumOut of non-func type"));
		}
		tt = t.kindType;
		return tt.out.$length;
	};
	rtype.prototype.NumOut = function() { return this.$val.NumOut(); };
	rtype.ptr.prototype.Out = function(i) {
		var $ptr, i, t, tt, x;
		t = this;
		if (!((t.Kind() === 19))) {
			$panic(new $String("reflect: Out of non-func type"));
		}
		tt = t.kindType;
		return toType((x = tt.out, ((i < 0 || i >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + i])));
	};
	rtype.prototype.Out = function(i) { return this.$val.Out(i); };
	ChanDir.prototype.String = function() {
		var $ptr, _2, d;
		d = this.$val;
		_2 = d;
		if (_2 === 2) {
			return "chan<-";
		} else if (_2 === 1) {
			return "<-chan";
		} else if (_2 === 3) {
			return "chan";
		}
		return "ChanDir" + strconv.Itoa((d >> 0));
	};
	$ptrType(ChanDir).prototype.String = function() { return new ChanDir(this.$get()).String(); };
	interfaceType.ptr.prototype.Method = function(i) {
		var $ptr, i, m, p, t, x;
		m = new Method.ptr("", "", $ifaceNil, new Value.ptr(ptrType$1.nil, 0, 0), 0);
		t = this;
		if (i < 0 || i >= t.methods.$length) {
			return m;
		}
		p = (x = t.methods, ((i < 0 || i >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + i]));
		m.Name = p.name.$get();
		if (!(p.pkgPath === ptrType$6.nil)) {
			m.PkgPath = p.pkgPath.$get();
		}
		m.Type = toType(p.typ);
		m.Index = i;
		return m;
	};
	interfaceType.prototype.Method = function(i) { return this.$val.Method(i); };
	interfaceType.ptr.prototype.NumMethod = function() {
		var $ptr, t;
		t = this;
		return t.methods.$length;
	};
	interfaceType.prototype.NumMethod = function() { return this.$val.NumMethod(); };
	interfaceType.ptr.prototype.MethodByName = function(name) {
		var $ptr, _i, _ref, _tmp, _tmp$1, i, m, name, ok, p, t, x;
		m = new Method.ptr("", "", $ifaceNil, new Value.ptr(ptrType$1.nil, 0, 0), 0);
		ok = false;
		t = this;
		if (t === ptrType$11.nil) {
			return [m, ok];
		}
		p = ptrType$12.nil;
		_ref = t.methods;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			i = _i;
			p = (x = t.methods, ((i < 0 || i >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + i]));
			if (p.name.$get() === name) {
				_tmp = $clone(t.Method(i), Method);
				_tmp$1 = true;
				Method.copy(m, _tmp);
				ok = _tmp$1;
				return [m, ok];
			}
			_i++;
		}
		return [m, ok];
	};
	interfaceType.prototype.MethodByName = function(name) { return this.$val.MethodByName(name); };
	StructTag.prototype.Get = function(key) {
		var $ptr, _tuple, err, i, key, name, qvalue, tag, value;
		tag = this.$val;
		while (true) {
			if (!(!(tag === ""))) { break; }
			i = 0;
			while (true) {
				if (!(i < tag.length && (tag.charCodeAt(i) === 32))) { break; }
				i = i + (1) >> 0;
			}
			tag = tag.substring(i);
			if (tag === "") {
				break;
			}
			i = 0;
			while (true) {
				if (!(i < tag.length && tag.charCodeAt(i) > 32 && !((tag.charCodeAt(i) === 58)) && !((tag.charCodeAt(i) === 34)) && !((tag.charCodeAt(i) === 127)))) { break; }
				i = i + (1) >> 0;
			}
			if ((i === 0) || (i + 1 >> 0) >= tag.length || !((tag.charCodeAt(i) === 58)) || !((tag.charCodeAt((i + 1 >> 0)) === 34))) {
				break;
			}
			name = tag.substring(0, i);
			tag = tag.substring((i + 1 >> 0));
			i = 1;
			while (true) {
				if (!(i < tag.length && !((tag.charCodeAt(i) === 34)))) { break; }
				if (tag.charCodeAt(i) === 92) {
					i = i + (1) >> 0;
				}
				i = i + (1) >> 0;
			}
			if (i >= tag.length) {
				break;
			}
			qvalue = tag.substring(0, (i + 1 >> 0));
			tag = tag.substring((i + 1 >> 0));
			if (key === name) {
				_tuple = strconv.Unquote(qvalue);
				value = _tuple[0];
				err = _tuple[1];
				if (!($interfaceIsEqual(err, $ifaceNil))) {
					break;
				}
				return value;
			}
		}
		return "";
	};
	$ptrType(StructTag).prototype.Get = function(key) { return new StructTag(this.$get()).Get(key); };
	structType.ptr.prototype.Field = function(i) {
		var $ptr, _r, _r$1, _r$2, f, i, p, t, t$1, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; f = $f.f; i = $f.i; p = $f.p; t = $f.t; t$1 = $f.t$1; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		f = new StructField.ptr("", "", $ifaceNil, "", 0, sliceType$11.nil, false);
		t = this;
		if (i < 0 || i >= t.fields.$length) {
			return f;
		}
		p = (x = t.fields, ((i < 0 || i >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + i]));
		f.Type = toType(p.typ);
		/* */ if (!(p.name === ptrType$6.nil)) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!(p.name === ptrType$6.nil)) { */ case 1:
			f.Name = p.name.$get();
			$s = 3; continue;
		/* } else { */ case 2:
			t$1 = f.Type;
			_r = t$1.Kind(); /* */ $s = 6; case 6: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			/* */ if (_r === 22) { $s = 4; continue; }
			/* */ $s = 5; continue;
			/* if (_r === 22) { */ case 4:
				_r$1 = t$1.Elem(); /* */ $s = 7; case 7: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
				t$1 = _r$1;
			/* } */ case 5:
			_r$2 = t$1.Name(); /* */ $s = 8; case 8: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
			f.Name = _r$2;
			f.Anonymous = true;
		/* } */ case 3:
		if (!(p.pkgPath === ptrType$6.nil)) {
			f.PkgPath = p.pkgPath.$get();
		}
		if (!(p.tag === ptrType$6.nil)) {
			f.Tag = p.tag.$get();
		}
		f.Offset = p.offset;
		f.Index = new sliceType$11([i]);
		return f;
		/* */ } return; } if ($f === undefined) { $f = { $blk: structType.ptr.prototype.Field }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f.f = f; $f.i = i; $f.p = p; $f.t = t; $f.t$1 = t$1; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	structType.prototype.Field = function(i) { return this.$val.Field(i); };
	structType.ptr.prototype.FieldByIndex = function(index) {
		var $ptr, _i, _r, _r$1, _r$2, _r$3, _r$4, _ref, _v, f, ft, i, index, t, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _i = $f._i; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; _ref = $f._ref; _v = $f._v; f = $f.f; ft = $f.ft; i = $f.i; index = $f.index; t = $f.t; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		f = new StructField.ptr("", "", $ifaceNil, "", 0, sliceType$11.nil, false);
		t = this;
		f.Type = toType(t.rtype);
		_ref = index;
		_i = 0;
		/* while (true) { */ case 1:
			/* if (!(_i < _ref.$length)) { break; } */ if(!(_i < _ref.$length)) { $s = 2; continue; }
			i = _i;
			x = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			/* */ if (i > 0) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (i > 0) { */ case 3:
				ft = f.Type;
				_r = ft.Kind(); /* */ $s = 8; case 8: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				if (!(_r === 22)) { _v = false; $s = 7; continue s; }
				_r$1 = ft.Elem(); /* */ $s = 9; case 9: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
				_r$2 = _r$1.Kind(); /* */ $s = 10; case 10: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
				_v = _r$2 === 25; case 7:
				/* */ if (_v) { $s = 5; continue; }
				/* */ $s = 6; continue;
				/* if (_v) { */ case 5:
					_r$3 = ft.Elem(); /* */ $s = 11; case 11: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
					ft = _r$3;
				/* } */ case 6:
				f.Type = ft;
			/* } */ case 4:
			_r$4 = f.Type.Field(x); /* */ $s = 12; case 12: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
			StructField.copy(f, _r$4);
			_i++;
		/* } */ $s = 1; continue; case 2:
		return f;
		/* */ } return; } if ($f === undefined) { $f = { $blk: structType.ptr.prototype.FieldByIndex }; } $f.$ptr = $ptr; $f._i = _i; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._ref = _ref; $f._v = _v; $f.f = f; $f.ft = ft; $f.i = i; $f.index = index; $f.t = t; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	structType.prototype.FieldByIndex = function(index) { return this.$val.FieldByIndex(index); };
	structType.ptr.prototype.FieldByNameFunc = function(match) {
		var $ptr, _entry, _entry$1, _entry$2, _entry$3, _i, _i$1, _key, _key$1, _key$2, _key$3, _r, _r$1, _r$2, _ref, _ref$1, _tmp, _tmp$1, _tmp$2, _tmp$3, count, current, f, fname, i, index, match, next, nextCount, ntyp, ok, result, scan, styp, t, t$1, visited, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _entry = $f._entry; _entry$1 = $f._entry$1; _entry$2 = $f._entry$2; _entry$3 = $f._entry$3; _i = $f._i; _i$1 = $f._i$1; _key = $f._key; _key$1 = $f._key$1; _key$2 = $f._key$2; _key$3 = $f._key$3; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _ref = $f._ref; _ref$1 = $f._ref$1; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tmp$2 = $f._tmp$2; _tmp$3 = $f._tmp$3; count = $f.count; current = $f.current; f = $f.f; fname = $f.fname; i = $f.i; index = $f.index; match = $f.match; next = $f.next; nextCount = $f.nextCount; ntyp = $f.ntyp; ok = $f.ok; result = $f.result; scan = $f.scan; styp = $f.styp; t = $f.t; t$1 = $f.t$1; visited = $f.visited; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		result = new StructField.ptr("", "", $ifaceNil, "", 0, sliceType$11.nil, false);
		ok = false;
		t = this;
		current = new sliceType$12([]);
		next = new sliceType$12([new fieldScan.ptr(t, sliceType$11.nil)]);
		nextCount = false;
		visited = $makeMap(ptrType$13.keyFor, []);
		/* while (true) { */ case 1:
			/* if (!(next.$length > 0)) { break; } */ if(!(next.$length > 0)) { $s = 2; continue; }
			_tmp = next;
			_tmp$1 = $subslice(current, 0, 0);
			current = _tmp;
			next = _tmp$1;
			count = nextCount;
			nextCount = false;
			_ref = current;
			_i = 0;
			/* while (true) { */ case 3:
				/* if (!(_i < _ref.$length)) { break; } */ if(!(_i < _ref.$length)) { $s = 4; continue; }
				scan = $clone(((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]), fieldScan);
				t$1 = scan.typ;
				/* */ if ((_entry = visited[ptrType$13.keyFor(t$1)], _entry !== undefined ? _entry.v : false)) { $s = 5; continue; }
				/* */ $s = 6; continue;
				/* if ((_entry = visited[ptrType$13.keyFor(t$1)], _entry !== undefined ? _entry.v : false)) { */ case 5:
					_i++;
					/* continue; */ $s = 3; continue;
				/* } */ case 6:
				_key = t$1; (visited || $throwRuntimeError("assignment to entry in nil map"))[ptrType$13.keyFor(_key)] = { k: _key, v: true };
				_ref$1 = t$1.fields;
				_i$1 = 0;
				/* while (true) { */ case 7:
					/* if (!(_i$1 < _ref$1.$length)) { break; } */ if(!(_i$1 < _ref$1.$length)) { $s = 8; continue; }
					i = _i$1;
					f = (x = t$1.fields, ((i < 0 || i >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + i]));
					fname = "";
					ntyp = ptrType$1.nil;
					/* */ if (!(f.name === ptrType$6.nil)) { $s = 9; continue; }
					/* */ $s = 10; continue;
					/* if (!(f.name === ptrType$6.nil)) { */ case 9:
						fname = f.name.$get();
						$s = 11; continue;
					/* } else { */ case 10:
						ntyp = f.typ;
						/* */ if (ntyp.Kind() === 22) { $s = 12; continue; }
						/* */ $s = 13; continue;
						/* if (ntyp.Kind() === 22) { */ case 12:
							_r = ntyp.Elem().common(); /* */ $s = 14; case 14: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
							ntyp = _r;
						/* } */ case 13:
						fname = ntyp.Name();
					/* } */ case 11:
					_r$1 = match(fname); /* */ $s = 17; case 17: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
					/* */ if (_r$1) { $s = 15; continue; }
					/* */ $s = 16; continue;
					/* if (_r$1) { */ case 15:
						if ((_entry$1 = count[ptrType$13.keyFor(t$1)], _entry$1 !== undefined ? _entry$1.v : 0) > 1 || ok) {
							_tmp$2 = new StructField.ptr("", "", $ifaceNil, "", 0, sliceType$11.nil, false);
							_tmp$3 = false;
							StructField.copy(result, _tmp$2);
							ok = _tmp$3;
							return [result, ok];
						}
						_r$2 = t$1.Field(i); /* */ $s = 18; case 18: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
						StructField.copy(result, _r$2);
						result.Index = sliceType$11.nil;
						result.Index = $appendSlice(result.Index, scan.index);
						result.Index = $append(result.Index, i);
						ok = true;
						_i$1++;
						/* continue; */ $s = 7; continue;
					/* } */ case 16:
					if (ok || ntyp === ptrType$1.nil || !((ntyp.Kind() === 25))) {
						_i$1++;
						/* continue; */ $s = 7; continue;
					}
					styp = ntyp.kindType;
					if ((_entry$2 = nextCount[ptrType$13.keyFor(styp)], _entry$2 !== undefined ? _entry$2.v : 0) > 0) {
						_key$1 = styp; (nextCount || $throwRuntimeError("assignment to entry in nil map"))[ptrType$13.keyFor(_key$1)] = { k: _key$1, v: 2 };
						_i$1++;
						/* continue; */ $s = 7; continue;
					}
					if (nextCount === false) {
						nextCount = $makeMap(ptrType$13.keyFor, []);
					}
					_key$2 = styp; (nextCount || $throwRuntimeError("assignment to entry in nil map"))[ptrType$13.keyFor(_key$2)] = { k: _key$2, v: 1 };
					if ((_entry$3 = count[ptrType$13.keyFor(t$1)], _entry$3 !== undefined ? _entry$3.v : 0) > 1) {
						_key$3 = styp; (nextCount || $throwRuntimeError("assignment to entry in nil map"))[ptrType$13.keyFor(_key$3)] = { k: _key$3, v: 2 };
					}
					index = sliceType$11.nil;
					index = $appendSlice(index, scan.index);
					index = $append(index, i);
					next = $append(next, new fieldScan.ptr(styp, index));
					_i$1++;
				/* } */ $s = 7; continue; case 8:
				_i++;
			/* } */ $s = 3; continue; case 4:
			if (ok) {
				/* break; */ $s = 2; continue;
			}
		/* } */ $s = 1; continue; case 2:
		return [result, ok];
		/* */ } return; } if ($f === undefined) { $f = { $blk: structType.ptr.prototype.FieldByNameFunc }; } $f.$ptr = $ptr; $f._entry = _entry; $f._entry$1 = _entry$1; $f._entry$2 = _entry$2; $f._entry$3 = _entry$3; $f._i = _i; $f._i$1 = _i$1; $f._key = _key; $f._key$1 = _key$1; $f._key$2 = _key$2; $f._key$3 = _key$3; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._ref = _ref; $f._ref$1 = _ref$1; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tmp$2 = _tmp$2; $f._tmp$3 = _tmp$3; $f.count = count; $f.current = current; $f.f = f; $f.fname = fname; $f.i = i; $f.index = index; $f.match = match; $f.next = next; $f.nextCount = nextCount; $f.ntyp = ntyp; $f.ok = ok; $f.result = result; $f.scan = scan; $f.styp = styp; $f.t = t; $f.t$1 = t$1; $f.visited = visited; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	structType.prototype.FieldByNameFunc = function(match) { return this.$val.FieldByNameFunc(match); };
	structType.ptr.prototype.FieldByName = function(name) {
		var $ptr, _i, _r, _r$1, _ref, _tmp, _tmp$1, _tuple, f, hasAnon, i, name, present, t, tf, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _i = $f._i; _r = $f._r; _r$1 = $f._r$1; _ref = $f._ref; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tuple = $f._tuple; f = $f.f; hasAnon = $f.hasAnon; i = $f.i; name = $f.name; present = $f.present; t = $f.t; tf = $f.tf; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		name = [name];
		f = new StructField.ptr("", "", $ifaceNil, "", 0, sliceType$11.nil, false);
		present = false;
		t = this;
		hasAnon = false;
		/* */ if (!(name[0] === "")) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!(name[0] === "")) { */ case 1:
			_ref = t.fields;
			_i = 0;
			/* while (true) { */ case 3:
				/* if (!(_i < _ref.$length)) { break; } */ if(!(_i < _ref.$length)) { $s = 4; continue; }
				i = _i;
				tf = (x = t.fields, ((i < 0 || i >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + i]));
				/* */ if (tf.name === ptrType$6.nil) { $s = 5; continue; }
				/* */ $s = 6; continue;
				/* if (tf.name === ptrType$6.nil) { */ case 5:
					hasAnon = true;
					_i++;
					/* continue; */ $s = 3; continue;
				/* } */ case 6:
				/* */ if (tf.name.$get() === name[0]) { $s = 7; continue; }
				/* */ $s = 8; continue;
				/* if (tf.name.$get() === name[0]) { */ case 7:
					_r = t.Field(i); /* */ $s = 9; case 9: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
					_tmp = $clone(_r, StructField);
					_tmp$1 = true;
					StructField.copy(f, _tmp);
					present = _tmp$1;
					/* */ $s = 10; case 10:
					return [f, present];
				/* } */ case 8:
				_i++;
			/* } */ $s = 3; continue; case 4:
		/* } */ case 2:
		if (!hasAnon) {
			return [f, present];
		}
		_r$1 = t.FieldByNameFunc((function(name) { return function(s) {
			var $ptr, s;
			return s === name[0];
		}; })(name)); /* */ $s = 11; case 11: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_tuple = _r$1;
		StructField.copy(f, _tuple[0]);
		present = _tuple[1];
		/* */ $s = 12; case 12:
		return [f, present];
		/* */ } return; } if ($f === undefined) { $f = { $blk: structType.ptr.prototype.FieldByName }; } $f.$ptr = $ptr; $f._i = _i; $f._r = _r; $f._r$1 = _r$1; $f._ref = _ref; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tuple = _tuple; $f.f = f; $f.hasAnon = hasAnon; $f.i = i; $f.name = name; $f.present = present; $f.t = t; $f.tf = tf; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	structType.prototype.FieldByName = function(name) { return this.$val.FieldByName(name); };
	PtrTo = function(t) {
		var $ptr, t;
		return $assertType(t, ptrType$1).ptrTo();
	};
	$pkg.PtrTo = PtrTo;
	rtype.ptr.prototype.Implements = function(u) {
		var $ptr, _r, t, u, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; t = $f.t; u = $f.u; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		if ($interfaceIsEqual(u, $ifaceNil)) {
			$panic(new $String("reflect: nil type passed to Type.Implements"));
		}
		_r = u.Kind(); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ if (!((_r === 20))) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!((_r === 20))) { */ case 1:
			$panic(new $String("reflect: non-interface type passed to Type.Implements"));
		/* } */ case 2:
		return implements$1($assertType(u, ptrType$1), t);
		/* */ } return; } if ($f === undefined) { $f = { $blk: rtype.ptr.prototype.Implements }; } $f.$ptr = $ptr; $f._r = _r; $f.t = t; $f.u = u; $f.$s = $s; $f.$r = $r; return $f;
	};
	rtype.prototype.Implements = function(u) { return this.$val.Implements(u); };
	rtype.ptr.prototype.AssignableTo = function(u) {
		var $ptr, t, u, uu;
		t = this;
		if ($interfaceIsEqual(u, $ifaceNil)) {
			$panic(new $String("reflect: nil type passed to Type.AssignableTo"));
		}
		uu = $assertType(u, ptrType$1);
		return directlyAssignable(uu, t) || implements$1(uu, t);
	};
	rtype.prototype.AssignableTo = function(u) { return this.$val.AssignableTo(u); };
	rtype.ptr.prototype.ConvertibleTo = function(u) {
		var $ptr, _r, t, u, uu, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; t = $f.t; u = $f.u; uu = $f.uu; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		if ($interfaceIsEqual(u, $ifaceNil)) {
			$panic(new $String("reflect: nil type passed to Type.ConvertibleTo"));
		}
		uu = $assertType(u, ptrType$1);
		_r = convertOp(uu, t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return !(_r === $throwNilPointerError);
		/* */ } return; } if ($f === undefined) { $f = { $blk: rtype.ptr.prototype.ConvertibleTo }; } $f.$ptr = $ptr; $f._r = _r; $f.t = t; $f.u = u; $f.uu = uu; $f.$s = $s; $f.$r = $r; return $f;
	};
	rtype.prototype.ConvertibleTo = function(u) { return this.$val.ConvertibleTo(u); };
	implements$1 = function(T, V) {
		var $ptr, T, V, i, i$1, j, j$1, t, tm, tm$1, v, v$1, vm, vm$1, x, x$1, x$2, x$3;
		if (!((T.Kind() === 20))) {
			return false;
		}
		t = T.kindType;
		if (t.methods.$length === 0) {
			return true;
		}
		if (V.Kind() === 20) {
			v = V.kindType;
			i = 0;
			j = 0;
			while (true) {
				if (!(j < v.methods.$length)) { break; }
				tm = (x = t.methods, ((i < 0 || i >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + i]));
				vm = (x$1 = v.methods, ((j < 0 || j >= x$1.$length) ? $throwRuntimeError("index out of range") : x$1.$array[x$1.$offset + j]));
				if (vm.name.$get() === tm.name.$get() && vm.pkgPath === tm.pkgPath && vm.typ === tm.typ) {
					i = i + (1) >> 0;
					if (i >= t.methods.$length) {
						return true;
					}
				}
				j = j + (1) >> 0;
			}
			return false;
		}
		v$1 = V.uncommonType.uncommon();
		if (v$1 === ptrType$7.nil) {
			return false;
		}
		i$1 = 0;
		j$1 = 0;
		while (true) {
			if (!(j$1 < v$1.methods.$length)) { break; }
			tm$1 = (x$2 = t.methods, ((i$1 < 0 || i$1 >= x$2.$length) ? $throwRuntimeError("index out of range") : x$2.$array[x$2.$offset + i$1]));
			vm$1 = (x$3 = v$1.methods, ((j$1 < 0 || j$1 >= x$3.$length) ? $throwRuntimeError("index out of range") : x$3.$array[x$3.$offset + j$1]));
			if (vm$1.name.$get() === tm$1.name.$get() && vm$1.pkgPath === tm$1.pkgPath && vm$1.mtyp === tm$1.typ) {
				i$1 = i$1 + (1) >> 0;
				if (i$1 >= t.methods.$length) {
					return true;
				}
			}
			j$1 = j$1 + (1) >> 0;
		}
		return false;
	};
	directlyAssignable = function(T, V) {
		var $ptr, T, V;
		if (T === V) {
			return true;
		}
		if (!(T.Name() === "") && !(V.Name() === "") || !((T.Kind() === V.Kind()))) {
			return false;
		}
		return haveIdenticalUnderlyingType(T, V);
	};
	haveIdenticalUnderlyingType = function(T, V) {
		var $ptr, T, V, _3, _i, _i$1, _i$2, _ref, _ref$1, _ref$2, i, i$1, i$2, kind, t, t$1, t$2, tf, typ, typ$1, v, v$1, v$2, vf, x, x$1, x$2, x$3;
		if (T === V) {
			return true;
		}
		kind = T.Kind();
		if (!((kind === V.Kind()))) {
			return false;
		}
		if (1 <= kind && kind <= 16 || (kind === 24) || (kind === 26)) {
			return true;
		}
		_3 = kind;
		if (_3 === 17) {
			return $interfaceIsEqual(T.Elem(), V.Elem()) && (T.Len() === V.Len());
		} else if (_3 === 18) {
			if ((V.ChanDir() === 3) && $interfaceIsEqual(T.Elem(), V.Elem())) {
				return true;
			}
			return (V.ChanDir() === T.ChanDir()) && $interfaceIsEqual(T.Elem(), V.Elem());
		} else if (_3 === 19) {
			t = T.kindType;
			v = V.kindType;
			if (!(t.dotdotdot === v.dotdotdot) || !((t.in$2.$length === v.in$2.$length)) || !((t.out.$length === v.out.$length))) {
				return false;
			}
			_ref = t.in$2;
			_i = 0;
			while (true) {
				if (!(_i < _ref.$length)) { break; }
				i = _i;
				typ = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
				if (!(typ === (x = v.in$2, ((i < 0 || i >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + i])))) {
					return false;
				}
				_i++;
			}
			_ref$1 = t.out;
			_i$1 = 0;
			while (true) {
				if (!(_i$1 < _ref$1.$length)) { break; }
				i$1 = _i$1;
				typ$1 = ((_i$1 < 0 || _i$1 >= _ref$1.$length) ? $throwRuntimeError("index out of range") : _ref$1.$array[_ref$1.$offset + _i$1]);
				if (!(typ$1 === (x$1 = v.out, ((i$1 < 0 || i$1 >= x$1.$length) ? $throwRuntimeError("index out of range") : x$1.$array[x$1.$offset + i$1])))) {
					return false;
				}
				_i$1++;
			}
			return true;
		} else if (_3 === 20) {
			t$1 = T.kindType;
			v$1 = V.kindType;
			if ((t$1.methods.$length === 0) && (v$1.methods.$length === 0)) {
				return true;
			}
			return false;
		} else if (_3 === 21) {
			return $interfaceIsEqual(T.Key(), V.Key()) && $interfaceIsEqual(T.Elem(), V.Elem());
		} else if ((_3 === 22) || (_3 === 23)) {
			return $interfaceIsEqual(T.Elem(), V.Elem());
		} else if (_3 === 25) {
			t$2 = T.kindType;
			v$2 = V.kindType;
			if (!((t$2.fields.$length === v$2.fields.$length))) {
				return false;
			}
			_ref$2 = t$2.fields;
			_i$2 = 0;
			while (true) {
				if (!(_i$2 < _ref$2.$length)) { break; }
				i$2 = _i$2;
				tf = (x$2 = t$2.fields, ((i$2 < 0 || i$2 >= x$2.$length) ? $throwRuntimeError("index out of range") : x$2.$array[x$2.$offset + i$2]));
				vf = (x$3 = v$2.fields, ((i$2 < 0 || i$2 >= x$3.$length) ? $throwRuntimeError("index out of range") : x$3.$array[x$3.$offset + i$2]));
				if (!(tf.name === vf.name) && (tf.name === ptrType$6.nil || vf.name === ptrType$6.nil || !(tf.name.$get() === vf.name.$get()))) {
					return false;
				}
				if (!(tf.pkgPath === vf.pkgPath) && (tf.pkgPath === ptrType$6.nil || vf.pkgPath === ptrType$6.nil || !(tf.pkgPath.$get() === vf.pkgPath.$get()))) {
					return false;
				}
				if (!(tf.typ === vf.typ)) {
					return false;
				}
				if (!(tf.tag === vf.tag) && (tf.tag === ptrType$6.nil || vf.tag === ptrType$6.nil || !(tf.tag.$get() === vf.tag.$get()))) {
					return false;
				}
				if (!((tf.offset === vf.offset))) {
					return false;
				}
				_i$2++;
			}
			return true;
		}
		return false;
	};
	toType = function(t) {
		var $ptr, t;
		if (t === ptrType$1.nil) {
			return $ifaceNil;
		}
		return t;
	};
	ifaceIndir = function(t) {
		var $ptr, t;
		return ((t.kind & 32) >>> 0) === 0;
	};
	flag.prototype.kind = function() {
		var $ptr, f;
		f = this.$val;
		return (((f & 31) >>> 0) >>> 0);
	};
	$ptrType(flag).prototype.kind = function() { return new flag(this.$get()).kind(); };
	Value.ptr.prototype.pointer = function() {
		var $ptr, v;
		v = this;
		if (!((v.typ.size === 4)) || !v.typ.pointers()) {
			$panic(new $String("can't call pointer on a non-pointer Value"));
		}
		if (!((((v.flag & 128) >>> 0) === 0))) {
			return v.ptr.$get();
		}
		return v.ptr;
	};
	Value.prototype.pointer = function() { return this.$val.pointer(); };
	ValueError.ptr.prototype.Error = function() {
		var $ptr, e;
		e = this;
		if (e.Kind === 0) {
			return "reflect: call of " + e.Method + " on zero Value";
		}
		return "reflect: call of " + e.Method + " on " + new Kind(e.Kind).String() + " Value";
	};
	ValueError.prototype.Error = function() { return this.$val.Error(); };
	flag.prototype.mustBe = function(expected) {
		var $ptr, expected, f;
		f = this.$val;
		if (!((new flag(f).kind() === expected))) {
			$panic(new ValueError.ptr(methodName(), new flag(f).kind()));
		}
	};
	$ptrType(flag).prototype.mustBe = function(expected) { return new flag(this.$get()).mustBe(expected); };
	flag.prototype.mustBeExported = function() {
		var $ptr, f;
		f = this.$val;
		if (f === 0) {
			$panic(new ValueError.ptr(methodName(), 0));
		}
		if (!((((f & 96) >>> 0) === 0))) {
			$panic(new $String("reflect: " + methodName() + " using value obtained using unexported field"));
		}
	};
	$ptrType(flag).prototype.mustBeExported = function() { return new flag(this.$get()).mustBeExported(); };
	flag.prototype.mustBeAssignable = function() {
		var $ptr, f;
		f = this.$val;
		if (f === 0) {
			$panic(new ValueError.ptr(methodName(), 0));
		}
		if (!((((f & 96) >>> 0) === 0))) {
			$panic(new $String("reflect: " + methodName() + " using value obtained using unexported field"));
		}
		if (((f & 256) >>> 0) === 0) {
			$panic(new $String("reflect: " + methodName() + " using unaddressable value"));
		}
	};
	$ptrType(flag).prototype.mustBeAssignable = function() { return new flag(this.$get()).mustBeAssignable(); };
	Value.ptr.prototype.Addr = function() {
		var $ptr, v;
		v = this;
		if (((v.flag & 256) >>> 0) === 0) {
			$panic(new $String("reflect.Value.Addr of unaddressable value"));
		}
		return new Value.ptr(v.typ.ptrTo(), v.ptr, ((((v.flag & 96) >>> 0)) | 22) >>> 0);
	};
	Value.prototype.Addr = function() { return this.$val.Addr(); };
	Value.ptr.prototype.Bool = function() {
		var $ptr, v;
		v = this;
		new flag(v.flag).mustBe(1);
		return v.ptr.$get();
	};
	Value.prototype.Bool = function() { return this.$val.Bool(); };
	Value.ptr.prototype.Bytes = function() {
		var $ptr, _r, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		new flag(v.flag).mustBe(23);
		_r = v.typ.Elem().Kind(); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ if (!((_r === 8))) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!((_r === 8))) { */ case 1:
			$panic(new $String("reflect.Value.Bytes of non-byte slice"));
		/* } */ case 2:
		return v.ptr.$get();
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.Bytes }; } $f.$ptr = $ptr; $f._r = _r; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.Bytes = function() { return this.$val.Bytes(); };
	Value.ptr.prototype.runes = function() {
		var $ptr, _r, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		new flag(v.flag).mustBe(23);
		_r = v.typ.Elem().Kind(); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ if (!((_r === 5))) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!((_r === 5))) { */ case 1:
			$panic(new $String("reflect.Value.Bytes of non-rune slice"));
		/* } */ case 2:
		return v.ptr.$get();
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.runes }; } $f.$ptr = $ptr; $f._r = _r; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.runes = function() { return this.$val.runes(); };
	Value.ptr.prototype.CanAddr = function() {
		var $ptr, v;
		v = this;
		return !((((v.flag & 256) >>> 0) === 0));
	};
	Value.prototype.CanAddr = function() { return this.$val.CanAddr(); };
	Value.ptr.prototype.CanSet = function() {
		var $ptr, v;
		v = this;
		return ((v.flag & 352) >>> 0) === 256;
	};
	Value.prototype.CanSet = function() { return this.$val.CanSet(); };
	Value.ptr.prototype.Call = function(in$1) {
		var $ptr, _r, in$1, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; in$1 = $f.in$1; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		new flag(v.flag).mustBe(19);
		new flag(v.flag).mustBeExported();
		_r = v.call("Call", in$1); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.Call }; } $f.$ptr = $ptr; $f._r = _r; $f.in$1 = in$1; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.Call = function(in$1) { return this.$val.Call(in$1); };
	Value.ptr.prototype.CallSlice = function(in$1) {
		var $ptr, _r, in$1, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; in$1 = $f.in$1; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		new flag(v.flag).mustBe(19);
		new flag(v.flag).mustBeExported();
		_r = v.call("CallSlice", in$1); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.CallSlice }; } $f.$ptr = $ptr; $f._r = _r; $f.in$1 = in$1; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.CallSlice = function(in$1) { return this.$val.CallSlice(in$1); };
	Value.ptr.prototype.Complex = function() {
		var $ptr, _2, k, v, x;
		v = this;
		k = new flag(v.flag).kind();
		_2 = k;
		if (_2 === 15) {
			return (x = v.ptr.$get(), new $Complex128(x.$real, x.$imag));
		} else if (_2 === 16) {
			return v.ptr.$get();
		}
		$panic(new ValueError.ptr("reflect.Value.Complex", new flag(v.flag).kind()));
	};
	Value.prototype.Complex = function() { return this.$val.Complex(); };
	Value.ptr.prototype.FieldByIndex = function(index) {
		var $ptr, _i, _r, _r$1, _r$2, _r$3, _ref, _v, i, index, v, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _i = $f._i; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _ref = $f._ref; _v = $f._v; i = $f.i; index = $f.index; v = $f.v; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		/* */ if (index.$length === 1) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (index.$length === 1) { */ case 1:
			_r = v.Field((0 >= index.$length ? $throwRuntimeError("index out of range") : index.$array[index.$offset + 0])); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			/* */ $s = 4; case 4:
			return _r;
		/* } */ case 2:
		new flag(v.flag).mustBe(25);
		_ref = index;
		_i = 0;
		/* while (true) { */ case 5:
			/* if (!(_i < _ref.$length)) { break; } */ if(!(_i < _ref.$length)) { $s = 6; continue; }
			i = _i;
			x = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			/* */ if (i > 0) { $s = 7; continue; }
			/* */ $s = 8; continue;
			/* if (i > 0) { */ case 7:
				if (!(v.Kind() === 22)) { _v = false; $s = 11; continue s; }
				_r$1 = v.typ.Elem().Kind(); /* */ $s = 12; case 12: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
				_v = _r$1 === 25; case 11:
				/* */ if (_v) { $s = 9; continue; }
				/* */ $s = 10; continue;
				/* if (_v) { */ case 9:
					if (v.IsNil()) {
						$panic(new $String("reflect: indirection through nil pointer to embedded struct"));
					}
					_r$2 = v.Elem(); /* */ $s = 13; case 13: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
					v = _r$2;
				/* } */ case 10:
			/* } */ case 8:
			_r$3 = v.Field(x); /* */ $s = 14; case 14: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
			v = _r$3;
			_i++;
		/* } */ $s = 5; continue; case 6:
		return v;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.FieldByIndex }; } $f.$ptr = $ptr; $f._i = _i; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._ref = _ref; $f._v = _v; $f.i = i; $f.index = index; $f.v = v; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.FieldByIndex = function(index) { return this.$val.FieldByIndex(index); };
	Value.ptr.prototype.FieldByName = function(name) {
		var $ptr, _r, _r$1, _tuple, f, name, ok, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _tuple = $f._tuple; f = $f.f; name = $f.name; ok = $f.ok; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		new flag(v.flag).mustBe(25);
		_r = v.typ.FieldByName(name); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		f = $clone(_tuple[0], StructField);
		ok = _tuple[1];
		/* */ if (ok) { $s = 2; continue; }
		/* */ $s = 3; continue;
		/* if (ok) { */ case 2:
			_r$1 = v.FieldByIndex(f.Index); /* */ $s = 4; case 4: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			/* */ $s = 5; case 5:
			return _r$1;
		/* } */ case 3:
		return new Value.ptr(ptrType$1.nil, 0, 0);
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.FieldByName }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._tuple = _tuple; $f.f = f; $f.name = name; $f.ok = ok; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.FieldByName = function(name) { return this.$val.FieldByName(name); };
	Value.ptr.prototype.FieldByNameFunc = function(match) {
		var $ptr, _r, _r$1, _tuple, f, match, ok, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _tuple = $f._tuple; f = $f.f; match = $f.match; ok = $f.ok; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		_r = v.typ.FieldByNameFunc(match); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		f = $clone(_tuple[0], StructField);
		ok = _tuple[1];
		/* */ if (ok) { $s = 2; continue; }
		/* */ $s = 3; continue;
		/* if (ok) { */ case 2:
			_r$1 = v.FieldByIndex(f.Index); /* */ $s = 4; case 4: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			/* */ $s = 5; case 5:
			return _r$1;
		/* } */ case 3:
		return new Value.ptr(ptrType$1.nil, 0, 0);
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.FieldByNameFunc }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._tuple = _tuple; $f.f = f; $f.match = match; $f.ok = ok; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.FieldByNameFunc = function(match) { return this.$val.FieldByNameFunc(match); };
	Value.ptr.prototype.Float = function() {
		var $ptr, _4, k, v;
		v = this;
		k = new flag(v.flag).kind();
		_4 = k;
		if (_4 === 13) {
			return v.ptr.$get();
		} else if (_4 === 14) {
			return v.ptr.$get();
		}
		$panic(new ValueError.ptr("reflect.Value.Float", new flag(v.flag).kind()));
	};
	Value.prototype.Float = function() { return this.$val.Float(); };
	Value.ptr.prototype.Int = function() {
		var $ptr, _6, k, p, v;
		v = this;
		k = new flag(v.flag).kind();
		p = v.ptr;
		_6 = k;
		if (_6 === 2) {
			return new $Int64(0, p.$get());
		} else if (_6 === 3) {
			return new $Int64(0, p.$get());
		} else if (_6 === 4) {
			return new $Int64(0, p.$get());
		} else if (_6 === 5) {
			return new $Int64(0, p.$get());
		} else if (_6 === 6) {
			return p.$get();
		}
		$panic(new ValueError.ptr("reflect.Value.Int", new flag(v.flag).kind()));
	};
	Value.prototype.Int = function() { return this.$val.Int(); };
	Value.ptr.prototype.CanInterface = function() {
		var $ptr, v;
		v = this;
		if (v.flag === 0) {
			$panic(new ValueError.ptr("reflect.Value.CanInterface", 0));
		}
		return ((v.flag & 96) >>> 0) === 0;
	};
	Value.prototype.CanInterface = function() { return this.$val.CanInterface(); };
	Value.ptr.prototype.Interface = function() {
		var $ptr, _r, i, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; i = $f.i; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		i = $ifaceNil;
		v = this;
		_r = valueInterface(v, true); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		i = _r;
		/* */ $s = 2; case 2:
		return i;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.Interface }; } $f.$ptr = $ptr; $f._r = _r; $f.i = i; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.Interface = function() { return this.$val.Interface(); };
	Value.ptr.prototype.IsValid = function() {
		var $ptr, v;
		v = this;
		return !((v.flag === 0));
	};
	Value.prototype.IsValid = function() { return this.$val.IsValid(); };
	Value.ptr.prototype.Kind = function() {
		var $ptr, v;
		v = this;
		return new flag(v.flag).kind();
	};
	Value.prototype.Kind = function() { return this.$val.Kind(); };
	Value.ptr.prototype.MapIndex = function(key) {
		var $ptr, _r, c, e, fl, k, key, tt, typ, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; c = $f.c; e = $f.e; fl = $f.fl; k = $f.k; key = $f.key; tt = $f.tt; typ = $f.typ; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		key = key;
		v = this;
		new flag(v.flag).mustBe(21);
		tt = v.typ.kindType;
		_r = key.assignTo("reflect.Value.MapIndex", tt.key, 0); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		key = _r;
		k = 0;
		if (!((((key.flag & 128) >>> 0) === 0))) {
			k = key.ptr;
		} else {
			k = (key.$ptr_ptr || (key.$ptr_ptr = new ptrType$18(function() { return this.$target.ptr; }, function($v) { this.$target.ptr = $v; }, key)));
		}
		e = mapaccess(v.typ, v.pointer(), k);
		if (e === 0) {
			return new Value.ptr(ptrType$1.nil, 0, 0);
		}
		typ = tt.elem;
		fl = ((((v.flag | key.flag) >>> 0)) & 96) >>> 0;
		fl = (fl | ((typ.Kind() >>> 0))) >>> 0;
		if (ifaceIndir(typ)) {
			c = unsafe_New(typ);
			typedmemmove(typ, c, e);
			return new Value.ptr(typ, c, (fl | 128) >>> 0);
		} else {
			return new Value.ptr(typ, e.$get(), fl);
		}
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.MapIndex }; } $f.$ptr = $ptr; $f._r = _r; $f.c = c; $f.e = e; $f.fl = fl; $f.k = k; $f.key = key; $f.tt = tt; $f.typ = typ; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.MapIndex = function(key) { return this.$val.MapIndex(key); };
	Value.ptr.prototype.MapKeys = function() {
		var $ptr, _r, a, c, fl, i, it, key, keyType, m, mlen, tt, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; a = $f.a; c = $f.c; fl = $f.fl; i = $f.i; it = $f.it; key = $f.key; keyType = $f.keyType; m = $f.m; mlen = $f.mlen; tt = $f.tt; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		new flag(v.flag).mustBe(21);
		tt = v.typ.kindType;
		keyType = tt.key;
		fl = (((v.flag & 96) >>> 0) | (keyType.Kind() >>> 0)) >>> 0;
		m = v.pointer();
		mlen = 0;
		if (!(m === 0)) {
			mlen = maplen(m);
		}
		it = mapiterinit(v.typ, m);
		a = $makeSlice(sliceType$8, mlen);
		i = 0;
		i = 0;
		/* while (true) { */ case 1:
			/* if (!(i < a.$length)) { break; } */ if(!(i < a.$length)) { $s = 2; continue; }
			_r = mapiterkey(it); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			key = _r;
			if (key === 0) {
				/* break; */ $s = 2; continue;
			}
			if (ifaceIndir(keyType)) {
				c = unsafe_New(keyType);
				typedmemmove(keyType, c, key);
				((i < 0 || i >= a.$length) ? $throwRuntimeError("index out of range") : a.$array[a.$offset + i] = new Value.ptr(keyType, c, (fl | 128) >>> 0));
			} else {
				((i < 0 || i >= a.$length) ? $throwRuntimeError("index out of range") : a.$array[a.$offset + i] = new Value.ptr(keyType, key.$get(), fl));
			}
			mapiternext(it);
			i = i + (1) >> 0;
		/* } */ $s = 1; continue; case 2:
		return $subslice(a, 0, i);
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.MapKeys }; } $f.$ptr = $ptr; $f._r = _r; $f.a = a; $f.c = c; $f.fl = fl; $f.i = i; $f.it = it; $f.key = key; $f.keyType = keyType; $f.m = m; $f.mlen = mlen; $f.tt = tt; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.MapKeys = function() { return this.$val.MapKeys(); };
	Value.ptr.prototype.Method = function(i) {
		var $ptr, fl, i, v;
		v = this;
		if (v.typ === ptrType$1.nil) {
			$panic(new ValueError.ptr("reflect.Value.Method", 0));
		}
		if (!((((v.flag & 512) >>> 0) === 0)) || (i >>> 0) >= (v.typ.NumMethod() >>> 0)) {
			$panic(new $String("reflect: Method index out of range"));
		}
		if ((v.typ.Kind() === 20) && v.IsNil()) {
			$panic(new $String("reflect: Method on nil interface value"));
		}
		fl = (v.flag & 160) >>> 0;
		fl = (fl | (19)) >>> 0;
		fl = (fl | (((((i >>> 0) << 10 >>> 0) | 512) >>> 0))) >>> 0;
		return new Value.ptr(v.typ, v.ptr, fl);
	};
	Value.prototype.Method = function(i) { return this.$val.Method(i); };
	Value.ptr.prototype.NumMethod = function() {
		var $ptr, v;
		v = this;
		if (v.typ === ptrType$1.nil) {
			$panic(new ValueError.ptr("reflect.Value.NumMethod", 0));
		}
		if (!((((v.flag & 512) >>> 0) === 0))) {
			return 0;
		}
		return v.typ.NumMethod();
	};
	Value.prototype.NumMethod = function() { return this.$val.NumMethod(); };
	Value.ptr.prototype.MethodByName = function(name) {
		var $ptr, _tuple, m, name, ok, v;
		v = this;
		if (v.typ === ptrType$1.nil) {
			$panic(new ValueError.ptr("reflect.Value.MethodByName", 0));
		}
		if (!((((v.flag & 512) >>> 0) === 0))) {
			return new Value.ptr(ptrType$1.nil, 0, 0);
		}
		_tuple = v.typ.MethodByName(name);
		m = $clone(_tuple[0], Method);
		ok = _tuple[1];
		if (!ok) {
			return new Value.ptr(ptrType$1.nil, 0, 0);
		}
		return v.Method(m.Index);
	};
	Value.prototype.MethodByName = function(name) { return this.$val.MethodByName(name); };
	Value.ptr.prototype.NumField = function() {
		var $ptr, tt, v;
		v = this;
		new flag(v.flag).mustBe(25);
		tt = v.typ.kindType;
		return tt.fields.$length;
	};
	Value.prototype.NumField = function() { return this.$val.NumField(); };
	Value.ptr.prototype.OverflowComplex = function(x) {
		var $ptr, _9, k, v, x;
		v = this;
		k = new flag(v.flag).kind();
		_9 = k;
		if (_9 === 15) {
			return overflowFloat32(x.$real) || overflowFloat32(x.$imag);
		} else if (_9 === 16) {
			return false;
		}
		$panic(new ValueError.ptr("reflect.Value.OverflowComplex", new flag(v.flag).kind()));
	};
	Value.prototype.OverflowComplex = function(x) { return this.$val.OverflowComplex(x); };
	Value.ptr.prototype.OverflowFloat = function(x) {
		var $ptr, _10, k, v, x;
		v = this;
		k = new flag(v.flag).kind();
		_10 = k;
		if (_10 === 13) {
			return overflowFloat32(x);
		} else if (_10 === 14) {
			return false;
		}
		$panic(new ValueError.ptr("reflect.Value.OverflowFloat", new flag(v.flag).kind()));
	};
	Value.prototype.OverflowFloat = function(x) { return this.$val.OverflowFloat(x); };
	overflowFloat32 = function(x) {
		var $ptr, x;
		if (x < 0) {
			x = -x;
		}
		return 3.4028234663852886e+38 < x && x <= 1.7976931348623157e+308;
	};
	Value.ptr.prototype.OverflowInt = function(x) {
		var $ptr, _11, bitSize, k, trunc, v, x;
		v = this;
		k = new flag(v.flag).kind();
		_11 = k;
		if ((_11 === 2) || (_11 === 3) || (_11 === 4) || (_11 === 5) || (_11 === 6)) {
			bitSize = $imul(v.typ.size, 8) >>> 0;
			trunc = $shiftRightInt64(($shiftLeft64(x, ((64 - bitSize >>> 0)))), ((64 - bitSize >>> 0)));
			return !((x.$high === trunc.$high && x.$low === trunc.$low));
		}
		$panic(new ValueError.ptr("reflect.Value.OverflowInt", new flag(v.flag).kind()));
	};
	Value.prototype.OverflowInt = function(x) { return this.$val.OverflowInt(x); };
	Value.ptr.prototype.OverflowUint = function(x) {
		var $ptr, _12, bitSize, k, trunc, v, x;
		v = this;
		k = new flag(v.flag).kind();
		_12 = k;
		if ((_12 === 7) || (_12 === 12) || (_12 === 8) || (_12 === 9) || (_12 === 10) || (_12 === 11)) {
			bitSize = $imul(v.typ.size, 8) >>> 0;
			trunc = $shiftRightUint64(($shiftLeft64(x, ((64 - bitSize >>> 0)))), ((64 - bitSize >>> 0)));
			return !((x.$high === trunc.$high && x.$low === trunc.$low));
		}
		$panic(new ValueError.ptr("reflect.Value.OverflowUint", new flag(v.flag).kind()));
	};
	Value.prototype.OverflowUint = function(x) { return this.$val.OverflowUint(x); };
	Value.ptr.prototype.Recv = function() {
		var $ptr, _r, _tuple, ok, v, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tuple = $f._tuple; ok = $f.ok; v = $f.v; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		x = new Value.ptr(ptrType$1.nil, 0, 0);
		ok = false;
		v = this;
		new flag(v.flag).mustBe(18);
		new flag(v.flag).mustBeExported();
		_r = v.recv(false); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		x = _tuple[0];
		ok = _tuple[1];
		/* */ $s = 2; case 2:
		return [x, ok];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.Recv }; } $f.$ptr = $ptr; $f._r = _r; $f._tuple = _tuple; $f.ok = ok; $f.v = v; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.Recv = function() { return this.$val.Recv(); };
	Value.ptr.prototype.recv = function(nb) {
		var $ptr, _r, _tuple, nb, ok, p, selected, t, tt, v, val, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tuple = $f._tuple; nb = $f.nb; ok = $f.ok; p = $f.p; selected = $f.selected; t = $f.t; tt = $f.tt; v = $f.v; val = $f.val; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		val = new Value.ptr(ptrType$1.nil, 0, 0);
		ok = false;
		v = this;
		tt = v.typ.kindType;
		if (((tt.dir >> 0) & 1) === 0) {
			$panic(new $String("reflect: recv on send-only channel"));
		}
		t = tt.elem;
		val = new Value.ptr(t, 0, (t.Kind() >>> 0));
		p = 0;
		if (ifaceIndir(t)) {
			p = unsafe_New(t);
			val.ptr = p;
			val.flag = (val.flag | (128)) >>> 0;
		} else {
			p = (val.$ptr_ptr || (val.$ptr_ptr = new ptrType$18(function() { return this.$target.ptr; }, function($v) { this.$target.ptr = $v; }, val)));
		}
		_r = chanrecv(v.typ, v.pointer(), nb, p); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		selected = _tuple[0];
		ok = _tuple[1];
		if (!selected) {
			val = new Value.ptr(ptrType$1.nil, 0, 0);
		}
		return [val, ok];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.recv }; } $f.$ptr = $ptr; $f._r = _r; $f._tuple = _tuple; $f.nb = nb; $f.ok = ok; $f.p = p; $f.selected = selected; $f.t = t; $f.tt = tt; $f.v = v; $f.val = val; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.recv = function(nb) { return this.$val.recv(nb); };
	Value.ptr.prototype.Send = function(x) {
		var $ptr, _r, v, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; v = $f.v; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		x = x;
		v = this;
		new flag(v.flag).mustBe(18);
		new flag(v.flag).mustBeExported();
		_r = v.send(x, false); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_r;
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.Send }; } $f.$ptr = $ptr; $f._r = _r; $f.v = v; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.Send = function(x) { return this.$val.Send(x); };
	Value.ptr.prototype.send = function(x, nb) {
		var $ptr, _r, _r$1, nb, p, selected, tt, v, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; nb = $f.nb; p = $f.p; selected = $f.selected; tt = $f.tt; v = $f.v; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		selected = false;
		x = x;
		v = this;
		tt = v.typ.kindType;
		if (((tt.dir >> 0) & 2) === 0) {
			$panic(new $String("reflect: send on recv-only channel"));
		}
		new flag(x.flag).mustBeExported();
		_r = x.assignTo("reflect.Value.Send", tt.elem, 0); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		x = _r;
		p = 0;
		if (!((((x.flag & 128) >>> 0) === 0))) {
			p = x.ptr;
		} else {
			p = (x.$ptr_ptr || (x.$ptr_ptr = new ptrType$18(function() { return this.$target.ptr; }, function($v) { this.$target.ptr = $v; }, x)));
		}
		_r$1 = chansend(v.typ, v.pointer(), p, nb); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		selected = _r$1;
		/* */ $s = 3; case 3:
		return selected;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.send }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f.nb = nb; $f.p = p; $f.selected = selected; $f.tt = tt; $f.v = v; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.send = function(x, nb) { return this.$val.send(x, nb); };
	Value.ptr.prototype.SetBool = function(x) {
		var $ptr, v, x;
		v = this;
		new flag(v.flag).mustBeAssignable();
		new flag(v.flag).mustBe(1);
		v.ptr.$set(x);
	};
	Value.prototype.SetBool = function(x) { return this.$val.SetBool(x); };
	Value.ptr.prototype.setRunes = function(x) {
		var $ptr, _r, v, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; v = $f.v; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		new flag(v.flag).mustBeAssignable();
		new flag(v.flag).mustBe(23);
		_r = v.typ.Elem().Kind(); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ if (!((_r === 5))) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!((_r === 5))) { */ case 1:
			$panic(new $String("reflect.Value.setRunes of non-rune slice"));
		/* } */ case 2:
		v.ptr.$set(x);
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.setRunes }; } $f.$ptr = $ptr; $f._r = _r; $f.v = v; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.setRunes = function(x) { return this.$val.setRunes(x); };
	Value.ptr.prototype.SetComplex = function(x) {
		var $ptr, _14, k, v, x;
		v = this;
		new flag(v.flag).mustBeAssignable();
		k = new flag(v.flag).kind();
		_14 = k;
		if (_14 === 15) {
			v.ptr.$set(new $Complex64(x.$real, x.$imag));
		} else if (_14 === 16) {
			v.ptr.$set(x);
		} else {
			$panic(new ValueError.ptr("reflect.Value.SetComplex", new flag(v.flag).kind()));
		}
	};
	Value.prototype.SetComplex = function(x) { return this.$val.SetComplex(x); };
	Value.ptr.prototype.SetFloat = function(x) {
		var $ptr, _15, k, v, x;
		v = this;
		new flag(v.flag).mustBeAssignable();
		k = new flag(v.flag).kind();
		_15 = k;
		if (_15 === 13) {
			v.ptr.$set($fround(x));
		} else if (_15 === 14) {
			v.ptr.$set(x);
		} else {
			$panic(new ValueError.ptr("reflect.Value.SetFloat", new flag(v.flag).kind()));
		}
	};
	Value.prototype.SetFloat = function(x) { return this.$val.SetFloat(x); };
	Value.ptr.prototype.SetInt = function(x) {
		var $ptr, _16, k, v, x;
		v = this;
		new flag(v.flag).mustBeAssignable();
		k = new flag(v.flag).kind();
		_16 = k;
		if (_16 === 2) {
			v.ptr.$set(((x.$low + ((x.$high >> 31) * 4294967296)) >> 0));
		} else if (_16 === 3) {
			v.ptr.$set(((x.$low + ((x.$high >> 31) * 4294967296)) << 24 >> 24));
		} else if (_16 === 4) {
			v.ptr.$set(((x.$low + ((x.$high >> 31) * 4294967296)) << 16 >> 16));
		} else if (_16 === 5) {
			v.ptr.$set(((x.$low + ((x.$high >> 31) * 4294967296)) >> 0));
		} else if (_16 === 6) {
			v.ptr.$set(x);
		} else {
			$panic(new ValueError.ptr("reflect.Value.SetInt", new flag(v.flag).kind()));
		}
	};
	Value.prototype.SetInt = function(x) { return this.$val.SetInt(x); };
	Value.ptr.prototype.SetMapIndex = function(key, val) {
		var $ptr, _r, _r$1, e, k, key, tt, v, val, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; e = $f.e; k = $f.k; key = $f.key; tt = $f.tt; v = $f.v; val = $f.val; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		val = val;
		key = key;
		v = this;
		new flag(v.flag).mustBe(21);
		new flag(v.flag).mustBeExported();
		new flag(key.flag).mustBeExported();
		tt = v.typ.kindType;
		_r = key.assignTo("reflect.Value.SetMapIndex", tt.key, 0); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		key = _r;
		k = 0;
		if (!((((key.flag & 128) >>> 0) === 0))) {
			k = key.ptr;
		} else {
			k = (key.$ptr_ptr || (key.$ptr_ptr = new ptrType$18(function() { return this.$target.ptr; }, function($v) { this.$target.ptr = $v; }, key)));
		}
		if (val.typ === ptrType$1.nil) {
			mapdelete(v.typ, v.pointer(), k);
			return;
		}
		new flag(val.flag).mustBeExported();
		_r$1 = val.assignTo("reflect.Value.SetMapIndex", tt.elem, 0); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		val = _r$1;
		e = 0;
		if (!((((val.flag & 128) >>> 0) === 0))) {
			e = val.ptr;
		} else {
			e = (val.$ptr_ptr || (val.$ptr_ptr = new ptrType$18(function() { return this.$target.ptr; }, function($v) { this.$target.ptr = $v; }, val)));
		}
		$r = mapassign(v.typ, v.pointer(), k, e); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.SetMapIndex }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f.e = e; $f.k = k; $f.key = key; $f.tt = tt; $f.v = v; $f.val = val; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.SetMapIndex = function(key, val) { return this.$val.SetMapIndex(key, val); };
	Value.ptr.prototype.SetUint = function(x) {
		var $ptr, _17, k, v, x;
		v = this;
		new flag(v.flag).mustBeAssignable();
		k = new flag(v.flag).kind();
		_17 = k;
		if (_17 === 7) {
			v.ptr.$set((x.$low >>> 0));
		} else if (_17 === 8) {
			v.ptr.$set((x.$low << 24 >>> 24));
		} else if (_17 === 9) {
			v.ptr.$set((x.$low << 16 >>> 16));
		} else if (_17 === 10) {
			v.ptr.$set((x.$low >>> 0));
		} else if (_17 === 11) {
			v.ptr.$set(x);
		} else if (_17 === 12) {
			v.ptr.$set((x.$low >>> 0));
		} else {
			$panic(new ValueError.ptr("reflect.Value.SetUint", new flag(v.flag).kind()));
		}
	};
	Value.prototype.SetUint = function(x) { return this.$val.SetUint(x); };
	Value.ptr.prototype.SetPointer = function(x) {
		var $ptr, v, x;
		v = this;
		new flag(v.flag).mustBeAssignable();
		new flag(v.flag).mustBe(26);
		v.ptr.$set(x);
	};
	Value.prototype.SetPointer = function(x) { return this.$val.SetPointer(x); };
	Value.ptr.prototype.SetString = function(x) {
		var $ptr, v, x;
		v = this;
		new flag(v.flag).mustBeAssignable();
		new flag(v.flag).mustBe(24);
		v.ptr.$set(x);
	};
	Value.prototype.SetString = function(x) { return this.$val.SetString(x); };
	Value.ptr.prototype.String = function() {
		var $ptr, _20, _r, k, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _20 = $f._20; _r = $f._r; k = $f.k; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		k = new flag(v.flag).kind();
		_20 = k;
		if (_20 === 0) {
			return "<invalid Value>";
		} else if (_20 === 24) {
			return v.ptr.$get();
		}
		_r = v.Type().String(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return "<" + _r + " Value>";
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.String }; } $f.$ptr = $ptr; $f._20 = _20; $f._r = _r; $f.k = k; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.String = function() { return this.$val.String(); };
	Value.ptr.prototype.TryRecv = function() {
		var $ptr, _r, _tuple, ok, v, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tuple = $f._tuple; ok = $f.ok; v = $f.v; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		x = new Value.ptr(ptrType$1.nil, 0, 0);
		ok = false;
		v = this;
		new flag(v.flag).mustBe(18);
		new flag(v.flag).mustBeExported();
		_r = v.recv(true); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		x = _tuple[0];
		ok = _tuple[1];
		/* */ $s = 2; case 2:
		return [x, ok];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.TryRecv }; } $f.$ptr = $ptr; $f._r = _r; $f._tuple = _tuple; $f.ok = ok; $f.v = v; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.TryRecv = function() { return this.$val.TryRecv(); };
	Value.ptr.prototype.TrySend = function(x) {
		var $ptr, _r, v, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; v = $f.v; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		x = x;
		v = this;
		new flag(v.flag).mustBe(18);
		new flag(v.flag).mustBeExported();
		_r = v.send(x, true); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.TrySend }; } $f.$ptr = $ptr; $f._r = _r; $f.v = v; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.TrySend = function(x) { return this.$val.TrySend(x); };
	Value.ptr.prototype.Type = function() {
		var $ptr, f, i, m, m$1, tt, ut, v, x, x$1;
		v = this;
		f = v.flag;
		if (f === 0) {
			$panic(new ValueError.ptr("reflect.Value.Type", 0));
		}
		if (((f & 512) >>> 0) === 0) {
			return v.typ;
		}
		i = (v.flag >> 0) >> 10 >> 0;
		if (v.typ.Kind() === 20) {
			tt = v.typ.kindType;
			if ((i >>> 0) >= (tt.methods.$length >>> 0)) {
				$panic(new $String("reflect: internal error: invalid method index"));
			}
			m = (x = tt.methods, ((i < 0 || i >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + i]));
			return m.typ;
		}
		ut = v.typ.uncommonType.uncommon();
		if (ut === ptrType$7.nil || (i >>> 0) >= (ut.methods.$length >>> 0)) {
			$panic(new $String("reflect: internal error: invalid method index"));
		}
		m$1 = (x$1 = ut.methods, ((i < 0 || i >= x$1.$length) ? $throwRuntimeError("index out of range") : x$1.$array[x$1.$offset + i]));
		return m$1.mtyp;
	};
	Value.prototype.Type = function() { return this.$val.Type(); };
	Value.ptr.prototype.Uint = function() {
		var $ptr, _21, k, p, v, x;
		v = this;
		k = new flag(v.flag).kind();
		p = v.ptr;
		_21 = k;
		if (_21 === 7) {
			return new $Uint64(0, p.$get());
		} else if (_21 === 8) {
			return new $Uint64(0, p.$get());
		} else if (_21 === 9) {
			return new $Uint64(0, p.$get());
		} else if (_21 === 10) {
			return new $Uint64(0, p.$get());
		} else if (_21 === 11) {
			return p.$get();
		} else if (_21 === 12) {
			return (x = p.$get(), new $Uint64(0, x.constructor === Number ? x : 1));
		}
		$panic(new ValueError.ptr("reflect.Value.Uint", new flag(v.flag).kind()));
	};
	Value.prototype.Uint = function() { return this.$val.Uint(); };
	Value.ptr.prototype.UnsafeAddr = function() {
		var $ptr, v;
		v = this;
		if (v.typ === ptrType$1.nil) {
			$panic(new ValueError.ptr("reflect.Value.UnsafeAddr", 0));
		}
		if (((v.flag & 256) >>> 0) === 0) {
			$panic(new $String("reflect.Value.UnsafeAddr of unaddressable value"));
		}
		return v.ptr;
	};
	Value.prototype.UnsafeAddr = function() { return this.$val.UnsafeAddr(); };
	New = function(typ) {
		var $ptr, _r, _r$1, fl, ptr, typ, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; fl = $f.fl; ptr = $f.ptr; typ = $f.typ; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		if ($interfaceIsEqual(typ, $ifaceNil)) {
			$panic(new $String("reflect: New(nil)"));
		}
		ptr = unsafe_New($assertType(typ, ptrType$1));
		fl = 22;
		_r = typ.common(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_r$1 = _r.ptrTo(); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		/* */ $s = 3; case 3:
		return new Value.ptr(_r$1, ptr, fl);
		/* */ } return; } if ($f === undefined) { $f = { $blk: New }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f.fl = fl; $f.ptr = ptr; $f.typ = typ; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.New = New;
	Value.ptr.prototype.assignTo = function(context, dst, target) {
		var $ptr, _r, _r$1, context, dst, fl, target, v, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; context = $f.context; dst = $f.dst; fl = $f.fl; target = $f.target; v = $f.v; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		/* */ if (!((((v.flag & 512) >>> 0) === 0))) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!((((v.flag & 512) >>> 0) === 0))) { */ case 1:
			_r = makeMethodValue(context, v); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			v = _r;
		/* } */ case 2:
			/* */ if (directlyAssignable(dst, v.typ)) { $s = 5; continue; }
			/* */ if (implements$1(dst, v.typ)) { $s = 6; continue; }
			/* */ $s = 7; continue;
			/* if (directlyAssignable(dst, v.typ)) { */ case 5:
				v.typ = dst;
				fl = (v.flag & 480) >>> 0;
				fl = (fl | ((dst.Kind() >>> 0))) >>> 0;
				return new Value.ptr(dst, v.ptr, fl);
			/* } else if (implements$1(dst, v.typ)) { */ case 6:
				if (target === 0) {
					target = unsafe_New(dst);
				}
				_r$1 = valueInterface(v, false); /* */ $s = 8; case 8: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
				x = _r$1;
				if (dst.NumMethod() === 0) {
					target.$set(x);
				} else {
					ifaceE2I(dst, x, target);
				}
				return new Value.ptr(dst, target, 148);
			/* } */ case 7:
		case 4:
		$panic(new $String(context + ": value of type " + v.typ.String() + " is not assignable to type " + dst.String()));
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.assignTo }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f.context = context; $f.dst = dst; $f.fl = fl; $f.target = target; $f.v = v; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.assignTo = function(context, dst, target) { return this.$val.assignTo(context, dst, target); };
	Value.ptr.prototype.Convert = function(t) {
		var $ptr, _r, _r$1, _r$2, _r$3, _r$4, op, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; op = $f.op; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		/* */ if (!((((v.flag & 512) >>> 0) === 0))) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!((((v.flag & 512) >>> 0) === 0))) { */ case 1:
			_r = makeMethodValue("Convert", v); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			v = _r;
		/* } */ case 2:
		_r$1 = t.common(); /* */ $s = 4; case 4: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_r$2 = convertOp(_r$1, v.typ); /* */ $s = 5; case 5: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		op = _r$2;
		/* */ if (op === $throwNilPointerError) { $s = 6; continue; }
		/* */ $s = 7; continue;
		/* if (op === $throwNilPointerError) { */ case 6:
			_r$3 = t.String(); /* */ $s = 8; case 8: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
			$panic(new $String("reflect.Value.Convert: value of type " + v.typ.String() + " cannot be converted to type " + _r$3));
		/* } */ case 7:
		_r$4 = op(v, t); /* */ $s = 9; case 9: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
		/* */ $s = 10; case 10:
		return _r$4;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.Convert }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f.op = op; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.Convert = function(t) { return this.$val.Convert(t); };
	convertOp = function(dst, src) {
		var $ptr, _23, _24, _25, _26, _27, _28, _29, _arg, _arg$1, _r, _r$1, _r$2, _r$3, _r$4, _r$5, _r$6, _v, _v$1, _v$2, dst, src, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _23 = $f._23; _24 = $f._24; _25 = $f._25; _26 = $f._26; _27 = $f._27; _28 = $f._28; _29 = $f._29; _arg = $f._arg; _arg$1 = $f._arg$1; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; _r$5 = $f._r$5; _r$6 = $f._r$6; _v = $f._v; _v$1 = $f._v$1; _v$2 = $f._v$2; dst = $f.dst; src = $f.src; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
			_23 = src.Kind();
			/* */ if ((_23 === 2) || (_23 === 3) || (_23 === 4) || (_23 === 5) || (_23 === 6)) { $s = 2; continue; }
			/* */ if ((_23 === 7) || (_23 === 8) || (_23 === 9) || (_23 === 10) || (_23 === 11) || (_23 === 12)) { $s = 3; continue; }
			/* */ if ((_23 === 13) || (_23 === 14)) { $s = 4; continue; }
			/* */ if ((_23 === 15) || (_23 === 16)) { $s = 5; continue; }
			/* */ if (_23 === 24) { $s = 6; continue; }
			/* */ if (_23 === 23) { $s = 7; continue; }
			/* */ $s = 8; continue;
			/* if ((_23 === 2) || (_23 === 3) || (_23 === 4) || (_23 === 5) || (_23 === 6)) { */ case 2:
				_24 = dst.Kind();
				if ((_24 === 2) || (_24 === 3) || (_24 === 4) || (_24 === 5) || (_24 === 6) || (_24 === 7) || (_24 === 8) || (_24 === 9) || (_24 === 10) || (_24 === 11) || (_24 === 12)) {
					return cvtInt;
				} else if ((_24 === 13) || (_24 === 14)) {
					return cvtIntFloat;
				} else if (_24 === 24) {
					return cvtIntString;
				}
				$s = 8; continue;
			/* } else if ((_23 === 7) || (_23 === 8) || (_23 === 9) || (_23 === 10) || (_23 === 11) || (_23 === 12)) { */ case 3:
				_25 = dst.Kind();
				if ((_25 === 2) || (_25 === 3) || (_25 === 4) || (_25 === 5) || (_25 === 6) || (_25 === 7) || (_25 === 8) || (_25 === 9) || (_25 === 10) || (_25 === 11) || (_25 === 12)) {
					return cvtUint;
				} else if ((_25 === 13) || (_25 === 14)) {
					return cvtUintFloat;
				} else if (_25 === 24) {
					return cvtUintString;
				}
				$s = 8; continue;
			/* } else if ((_23 === 13) || (_23 === 14)) { */ case 4:
				_26 = dst.Kind();
				if ((_26 === 2) || (_26 === 3) || (_26 === 4) || (_26 === 5) || (_26 === 6)) {
					return cvtFloatInt;
				} else if ((_26 === 7) || (_26 === 8) || (_26 === 9) || (_26 === 10) || (_26 === 11) || (_26 === 12)) {
					return cvtFloatUint;
				} else if ((_26 === 13) || (_26 === 14)) {
					return cvtFloat;
				}
				$s = 8; continue;
			/* } else if ((_23 === 15) || (_23 === 16)) { */ case 5:
				_27 = dst.Kind();
				if ((_27 === 15) || (_27 === 16)) {
					return cvtComplex;
				}
				$s = 8; continue;
			/* } else if (_23 === 24) { */ case 6:
				if (!(dst.Kind() === 23)) { _v = false; $s = 11; continue s; }
				_r = dst.Elem().PkgPath(); /* */ $s = 12; case 12: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				_v = _r === ""; case 11:
				/* */ if (_v) { $s = 9; continue; }
				/* */ $s = 10; continue;
				/* if (_v) { */ case 9:
						_r$1 = dst.Elem().Kind(); /* */ $s = 14; case 14: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
						_28 = _r$1;
						if (_28 === 8) {
							return cvtStringBytes;
						} else if (_28 === 5) {
							return cvtStringRunes;
						}
					case 13:
				/* } */ case 10:
				$s = 8; continue;
			/* } else if (_23 === 23) { */ case 7:
				if (!(dst.Kind() === 24)) { _v$1 = false; $s = 17; continue s; }
				_r$2 = src.Elem().PkgPath(); /* */ $s = 18; case 18: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
				_v$1 = _r$2 === ""; case 17:
				/* */ if (_v$1) { $s = 15; continue; }
				/* */ $s = 16; continue;
				/* if (_v$1) { */ case 15:
						_r$3 = src.Elem().Kind(); /* */ $s = 20; case 20: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
						_29 = _r$3;
						if (_29 === 8) {
							return cvtBytesString;
						} else if (_29 === 5) {
							return cvtRunesString;
						}
					case 19:
				/* } */ case 16:
			/* } */ case 8:
		case 1:
		if (haveIdenticalUnderlyingType(dst, src)) {
			return cvtDirect;
		}
		if (!((dst.Kind() === 22) && dst.Name() === "" && (src.Kind() === 22) && src.Name() === "")) { _v$2 = false; $s = 23; continue s; }
		_r$4 = dst.Elem().common(); /* */ $s = 24; case 24: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
		_arg = _r$4;
		_r$5 = src.Elem().common(); /* */ $s = 25; case 25: if($c) { $c = false; _r$5 = _r$5.$blk(); } if (_r$5 && _r$5.$blk !== undefined) { break s; }
		_arg$1 = _r$5;
		_r$6 = haveIdenticalUnderlyingType(_arg, _arg$1); /* */ $s = 26; case 26: if($c) { $c = false; _r$6 = _r$6.$blk(); } if (_r$6 && _r$6.$blk !== undefined) { break s; }
		_v$2 = _r$6; case 23:
		/* */ if (_v$2) { $s = 21; continue; }
		/* */ $s = 22; continue;
		/* if (_v$2) { */ case 21:
			return cvtDirect;
		/* } */ case 22:
		if (implements$1(dst, src)) {
			if (src.Kind() === 20) {
				return cvtI2I;
			}
			return cvtT2I;
		}
		return $throwNilPointerError;
		/* */ } return; } if ($f === undefined) { $f = { $blk: convertOp }; } $f.$ptr = $ptr; $f._23 = _23; $f._24 = _24; $f._25 = _25; $f._26 = _26; $f._27 = _27; $f._28 = _28; $f._29 = _29; $f._arg = _arg; $f._arg$1 = _arg$1; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._r$5 = _r$5; $f._r$6 = _r$6; $f._v = _v; $f._v$1 = _v$1; $f._v$2 = _v$2; $f.dst = dst; $f.src = src; $f.$s = $s; $f.$r = $r; return $f;
	};
	makeFloat = function(f, v, t) {
		var $ptr, _31, _r, f, ptr, t, typ, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _31 = $f._31; _r = $f._r; f = $f.f; ptr = $f.ptr; t = $f.t; typ = $f.typ; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = t.common(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		typ = _r;
		ptr = unsafe_New(typ);
		_31 = typ.size;
		if (_31 === 4) {
			ptr.$set($fround(v));
		} else if (_31 === 8) {
			ptr.$set(v);
		}
		return new Value.ptr(typ, ptr, (((f | 128) >>> 0) | (typ.Kind() >>> 0)) >>> 0);
		/* */ } return; } if ($f === undefined) { $f = { $blk: makeFloat }; } $f.$ptr = $ptr; $f._31 = _31; $f._r = _r; $f.f = f; $f.ptr = ptr; $f.t = t; $f.typ = typ; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	makeComplex = function(f, v, t) {
		var $ptr, _32, _r, f, ptr, t, typ, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _32 = $f._32; _r = $f._r; f = $f.f; ptr = $f.ptr; t = $f.t; typ = $f.typ; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = t.common(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		typ = _r;
		ptr = unsafe_New(typ);
		_32 = typ.size;
		if (_32 === 8) {
			ptr.$set(new $Complex64(v.$real, v.$imag));
		} else if (_32 === 16) {
			ptr.$set(v);
		}
		return new Value.ptr(typ, ptr, (((f | 128) >>> 0) | (typ.Kind() >>> 0)) >>> 0);
		/* */ } return; } if ($f === undefined) { $f = { $blk: makeComplex }; } $f.$ptr = $ptr; $f._32 = _32; $f._r = _r; $f.f = f; $f.ptr = ptr; $f.t = t; $f.typ = typ; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	makeString = function(f, v, t) {
		var $ptr, _r, _r$1, f, ret, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; f = $f.f; ret = $f.ret; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = New(t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_r$1 = _r.Elem(); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		ret = _r$1;
		ret.SetString(v);
		ret.flag = (((ret.flag & ~256) >>> 0) | f) >>> 0;
		return ret;
		/* */ } return; } if ($f === undefined) { $f = { $blk: makeString }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f.f = f; $f.ret = ret; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	makeBytes = function(f, v, t) {
		var $ptr, _r, _r$1, f, ret, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; f = $f.f; ret = $f.ret; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = New(t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_r$1 = _r.Elem(); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		ret = _r$1;
		$r = ret.SetBytes(v); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		ret.flag = (((ret.flag & ~256) >>> 0) | f) >>> 0;
		return ret;
		/* */ } return; } if ($f === undefined) { $f = { $blk: makeBytes }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f.f = f; $f.ret = ret; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	makeRunes = function(f, v, t) {
		var $ptr, _r, _r$1, f, ret, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; f = $f.f; ret = $f.ret; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = New(t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_r$1 = _r.Elem(); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		ret = _r$1;
		$r = ret.setRunes(v); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		ret.flag = (((ret.flag & ~256) >>> 0) | f) >>> 0;
		return ret;
		/* */ } return; } if ($f === undefined) { $f = { $blk: makeRunes }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f.f = f; $f.ret = ret; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtInt = function(v, t) {
		var $ptr, _r, t, v, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; t = $f.t; v = $f.v; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		_r = makeInt((v.flag & 96) >>> 0, (x = v.Int(), new $Uint64(x.$high, x.$low)), t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtInt }; } $f.$ptr = $ptr; $f._r = _r; $f.t = t; $f.v = v; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtUint = function(v, t) {
		var $ptr, _r, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		_r = makeInt((v.flag & 96) >>> 0, v.Uint(), t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtUint }; } $f.$ptr = $ptr; $f._r = _r; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtFloatInt = function(v, t) {
		var $ptr, _r, t, v, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; t = $f.t; v = $f.v; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		_r = makeInt((v.flag & 96) >>> 0, (x = new $Int64(0, v.Float()), new $Uint64(x.$high, x.$low)), t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtFloatInt }; } $f.$ptr = $ptr; $f._r = _r; $f.t = t; $f.v = v; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtFloatUint = function(v, t) {
		var $ptr, _r, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		_r = makeInt((v.flag & 96) >>> 0, new $Uint64(0, v.Float()), t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtFloatUint }; } $f.$ptr = $ptr; $f._r = _r; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtIntFloat = function(v, t) {
		var $ptr, _r, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		_r = makeFloat((v.flag & 96) >>> 0, $flatten64(v.Int()), t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtIntFloat }; } $f.$ptr = $ptr; $f._r = _r; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtUintFloat = function(v, t) {
		var $ptr, _r, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		_r = makeFloat((v.flag & 96) >>> 0, $flatten64(v.Uint()), t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtUintFloat }; } $f.$ptr = $ptr; $f._r = _r; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtFloat = function(v, t) {
		var $ptr, _r, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		_r = makeFloat((v.flag & 96) >>> 0, v.Float(), t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtFloat }; } $f.$ptr = $ptr; $f._r = _r; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtComplex = function(v, t) {
		var $ptr, _r, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		_r = makeComplex((v.flag & 96) >>> 0, v.Complex(), t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtComplex }; } $f.$ptr = $ptr; $f._r = _r; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtIntString = function(v, t) {
		var $ptr, _r, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		_r = makeString((v.flag & 96) >>> 0, $encodeRune(v.Int().$low), t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtIntString }; } $f.$ptr = $ptr; $f._r = _r; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtUintString = function(v, t) {
		var $ptr, _r, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		_r = makeString((v.flag & 96) >>> 0, $encodeRune(v.Uint().$low), t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtUintString }; } $f.$ptr = $ptr; $f._r = _r; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtBytesString = function(v, t) {
		var $ptr, _arg, _arg$1, _arg$2, _r, _r$1, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _arg = $f._arg; _arg$1 = $f._arg$1; _arg$2 = $f._arg$2; _r = $f._r; _r$1 = $f._r$1; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		_arg = (v.flag & 96) >>> 0;
		_r = v.Bytes(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_arg$1 = $bytesToString(_r);
		_arg$2 = t;
		_r$1 = makeString(_arg, _arg$1, _arg$2); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		/* */ $s = 3; case 3:
		return _r$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtBytesString }; } $f.$ptr = $ptr; $f._arg = _arg; $f._arg$1 = _arg$1; $f._arg$2 = _arg$2; $f._r = _r; $f._r$1 = _r$1; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtStringBytes = function(v, t) {
		var $ptr, _arg, _arg$1, _arg$2, _r, _r$1, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _arg = $f._arg; _arg$1 = $f._arg$1; _arg$2 = $f._arg$2; _r = $f._r; _r$1 = $f._r$1; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		_arg = (v.flag & 96) >>> 0;
		_r = v.String(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_arg$1 = new sliceType$13($stringToBytes(_r));
		_arg$2 = t;
		_r$1 = makeBytes(_arg, _arg$1, _arg$2); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		/* */ $s = 3; case 3:
		return _r$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtStringBytes }; } $f.$ptr = $ptr; $f._arg = _arg; $f._arg$1 = _arg$1; $f._arg$2 = _arg$2; $f._r = _r; $f._r$1 = _r$1; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtRunesString = function(v, t) {
		var $ptr, _arg, _arg$1, _arg$2, _r, _r$1, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _arg = $f._arg; _arg$1 = $f._arg$1; _arg$2 = $f._arg$2; _r = $f._r; _r$1 = $f._r$1; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		_arg = (v.flag & 96) >>> 0;
		_r = v.runes(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_arg$1 = $runesToString(_r);
		_arg$2 = t;
		_r$1 = makeString(_arg, _arg$1, _arg$2); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		/* */ $s = 3; case 3:
		return _r$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtRunesString }; } $f.$ptr = $ptr; $f._arg = _arg; $f._arg$1 = _arg$1; $f._arg$2 = _arg$2; $f._r = _r; $f._r$1 = _r$1; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtStringRunes = function(v, t) {
		var $ptr, _arg, _arg$1, _arg$2, _r, _r$1, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _arg = $f._arg; _arg$1 = $f._arg$1; _arg$2 = $f._arg$2; _r = $f._r; _r$1 = $f._r$1; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		_arg = (v.flag & 96) >>> 0;
		_r = v.String(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_arg$1 = new sliceType$15($stringToRunes(_r));
		_arg$2 = t;
		_r$1 = makeRunes(_arg, _arg$1, _arg$2); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		/* */ $s = 3; case 3:
		return _r$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtStringRunes }; } $f.$ptr = $ptr; $f._arg = _arg; $f._arg$1 = _arg$1; $f._arg$2 = _arg$2; $f._r = _r; $f._r$1 = _r$1; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtT2I = function(v, typ) {
		var $ptr, _r, _r$1, _r$2, _r$3, _r$4, target, typ, v, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; target = $f.target; typ = $f.typ; v = $f.v; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		_r = typ.common(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_r$1 = unsafe_New(_r); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		target = _r$1;
		_r$2 = valueInterface(v, false); /* */ $s = 3; case 3: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		x = _r$2;
		_r$3 = typ.NumMethod(); /* */ $s = 7; case 7: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
		/* */ if (_r$3 === 0) { $s = 4; continue; }
		/* */ $s = 5; continue;
		/* if (_r$3 === 0) { */ case 4:
			target.$set(x);
			$s = 6; continue;
		/* } else { */ case 5:
			ifaceE2I($assertType(typ, ptrType$1), x, target);
		/* } */ case 6:
		_r$4 = typ.common(); /* */ $s = 8; case 8: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
		/* */ $s = 9; case 9:
		return new Value.ptr(_r$4, target, (((((v.flag & 96) >>> 0) | 128) >>> 0) | 20) >>> 0);
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtT2I }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f.target = target; $f.typ = typ; $f.v = v; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtI2I = function(v, typ) {
		var $ptr, _r, _r$1, _r$2, ret, typ, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; ret = $f.ret; typ = $f.typ; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		/* */ if (v.IsNil()) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (v.IsNil()) { */ case 1:
			_r = Zero(typ); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			ret = _r;
			ret.flag = (ret.flag | (((v.flag & 96) >>> 0))) >>> 0;
			return ret;
		/* } */ case 2:
		_r$1 = v.Elem(); /* */ $s = 4; case 4: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_r$2 = cvtT2I(_r$1, typ); /* */ $s = 5; case 5: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		/* */ $s = 6; case 6:
		return _r$2;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtI2I }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f.ret = ret; $f.typ = typ; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Kind.methods = [{prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$1.methods = [{prop: "ptrTo", name: "ptrTo", pkg: "reflect", typ: $funcType([], [ptrType$1], false)}, {prop: "pointers", name: "pointers", pkg: "reflect", typ: $funcType([], [$Bool], false)}, {prop: "Comparable", name: "Comparable", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Size", name: "Size", pkg: "", typ: $funcType([], [$Uintptr], false)}, {prop: "Bits", name: "Bits", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Align", name: "Align", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "FieldAlign", name: "FieldAlign", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Kind", name: "Kind", pkg: "", typ: $funcType([], [Kind], false)}, {prop: "common", name: "common", pkg: "reflect", typ: $funcType([], [ptrType$1], false)}, {prop: "NumMethod", name: "NumMethod", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Method", name: "Method", pkg: "", typ: $funcType([$Int], [Method], false)}, {prop: "MethodByName", name: "MethodByName", pkg: "", typ: $funcType([$String], [Method, $Bool], false)}, {prop: "PkgPath", name: "PkgPath", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Name", name: "Name", pkg: "", typ: $funcType([], [$String], false)}, {prop: "ChanDir", name: "ChanDir", pkg: "", typ: $funcType([], [ChanDir], false)}, {prop: "IsVariadic", name: "IsVariadic", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "Elem", name: "Elem", pkg: "", typ: $funcType([], [Type], false)}, {prop: "Field", name: "Field", pkg: "", typ: $funcType([$Int], [StructField], false)}, {prop: "FieldByIndex", name: "FieldByIndex", pkg: "", typ: $funcType([sliceType$11], [StructField], false)}, {prop: "FieldByName", name: "FieldByName", pkg: "", typ: $funcType([$String], [StructField, $Bool], false)}, {prop: "FieldByNameFunc", name: "FieldByNameFunc", pkg: "", typ: $funcType([funcType$3], [StructField, $Bool], false)}, {prop: "In", name: "In", pkg: "", typ: $funcType([$Int], [Type], false)}, {prop: "Key", name: "Key", pkg: "", typ: $funcType([], [Type], false)}, {prop: "Len", name: "Len", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "NumField", name: "NumField", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "NumIn", name: "NumIn", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "NumOut", name: "NumOut", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Out", name: "Out", pkg: "", typ: $funcType([$Int], [Type], false)}, {prop: "Implements", name: "Implements", pkg: "", typ: $funcType([Type], [$Bool], false)}, {prop: "AssignableTo", name: "AssignableTo", pkg: "", typ: $funcType([Type], [$Bool], false)}, {prop: "ConvertibleTo", name: "ConvertibleTo", pkg: "", typ: $funcType([Type], [$Bool], false)}];
	ptrType$7.methods = [{prop: "Method", name: "Method", pkg: "", typ: $funcType([$Int], [Method], false)}, {prop: "uncommon", name: "uncommon", pkg: "reflect", typ: $funcType([], [ptrType$7], false)}, {prop: "PkgPath", name: "PkgPath", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Name", name: "Name", pkg: "", typ: $funcType([], [$String], false)}, {prop: "NumMethod", name: "NumMethod", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "MethodByName", name: "MethodByName", pkg: "", typ: $funcType([$String], [Method, $Bool], false)}];
	ChanDir.methods = [{prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$11.methods = [{prop: "Method", name: "Method", pkg: "", typ: $funcType([$Int], [Method], false)}, {prop: "NumMethod", name: "NumMethod", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "MethodByName", name: "MethodByName", pkg: "", typ: $funcType([$String], [Method, $Bool], false)}];
	ptrType$13.methods = [{prop: "Field", name: "Field", pkg: "", typ: $funcType([$Int], [StructField], false)}, {prop: "FieldByIndex", name: "FieldByIndex", pkg: "", typ: $funcType([sliceType$11], [StructField], false)}, {prop: "FieldByNameFunc", name: "FieldByNameFunc", pkg: "", typ: $funcType([funcType$3], [StructField, $Bool], false)}, {prop: "FieldByName", name: "FieldByName", pkg: "", typ: $funcType([$String], [StructField, $Bool], false)}];
	StructTag.methods = [{prop: "Get", name: "Get", pkg: "", typ: $funcType([$String], [$String], false)}];
	Value.methods = [{prop: "object", name: "object", pkg: "reflect", typ: $funcType([], [ptrType$3], false)}, {prop: "call", name: "call", pkg: "reflect", typ: $funcType([$String, sliceType$8], [sliceType$8], false)}, {prop: "Cap", name: "Cap", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Elem", name: "Elem", pkg: "", typ: $funcType([], [Value], false)}, {prop: "Field", name: "Field", pkg: "", typ: $funcType([$Int], [Value], false)}, {prop: "Index", name: "Index", pkg: "", typ: $funcType([$Int], [Value], false)}, {prop: "InterfaceData", name: "InterfaceData", pkg: "", typ: $funcType([], [arrayType$3], false)}, {prop: "IsNil", name: "IsNil", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "Len", name: "Len", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Pointer", name: "Pointer", pkg: "", typ: $funcType([], [$Uintptr], false)}, {prop: "Set", name: "Set", pkg: "", typ: $funcType([Value], [], false)}, {prop: "SetBytes", name: "SetBytes", pkg: "", typ: $funcType([sliceType$13], [], false)}, {prop: "SetCap", name: "SetCap", pkg: "", typ: $funcType([$Int], [], false)}, {prop: "SetLen", name: "SetLen", pkg: "", typ: $funcType([$Int], [], false)}, {prop: "Slice", name: "Slice", pkg: "", typ: $funcType([$Int, $Int], [Value], false)}, {prop: "Slice3", name: "Slice3", pkg: "", typ: $funcType([$Int, $Int, $Int], [Value], false)}, {prop: "Close", name: "Close", pkg: "", typ: $funcType([], [], false)}, {prop: "pointer", name: "pointer", pkg: "reflect", typ: $funcType([], [$UnsafePointer], false)}, {prop: "Addr", name: "Addr", pkg: "", typ: $funcType([], [Value], false)}, {prop: "Bool", name: "Bool", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "Bytes", name: "Bytes", pkg: "", typ: $funcType([], [sliceType$13], false)}, {prop: "runes", name: "runes", pkg: "reflect", typ: $funcType([], [sliceType$15], false)}, {prop: "CanAddr", name: "CanAddr", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "CanSet", name: "CanSet", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "Call", name: "Call", pkg: "", typ: $funcType([sliceType$8], [sliceType$8], false)}, {prop: "CallSlice", name: "CallSlice", pkg: "", typ: $funcType([sliceType$8], [sliceType$8], false)}, {prop: "Complex", name: "Complex", pkg: "", typ: $funcType([], [$Complex128], false)}, {prop: "FieldByIndex", name: "FieldByIndex", pkg: "", typ: $funcType([sliceType$11], [Value], false)}, {prop: "FieldByName", name: "FieldByName", pkg: "", typ: $funcType([$String], [Value], false)}, {prop: "FieldByNameFunc", name: "FieldByNameFunc", pkg: "", typ: $funcType([funcType$3], [Value], false)}, {prop: "Float", name: "Float", pkg: "", typ: $funcType([], [$Float64], false)}, {prop: "Int", name: "Int", pkg: "", typ: $funcType([], [$Int64], false)}, {prop: "CanInterface", name: "CanInterface", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "Interface", name: "Interface", pkg: "", typ: $funcType([], [$emptyInterface], false)}, {prop: "IsValid", name: "IsValid", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "Kind", name: "Kind", pkg: "", typ: $funcType([], [Kind], false)}, {prop: "MapIndex", name: "MapIndex", pkg: "", typ: $funcType([Value], [Value], false)}, {prop: "MapKeys", name: "MapKeys", pkg: "", typ: $funcType([], [sliceType$8], false)}, {prop: "Method", name: "Method", pkg: "", typ: $funcType([$Int], [Value], false)}, {prop: "NumMethod", name: "NumMethod", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "MethodByName", name: "MethodByName", pkg: "", typ: $funcType([$String], [Value], false)}, {prop: "NumField", name: "NumField", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "OverflowComplex", name: "OverflowComplex", pkg: "", typ: $funcType([$Complex128], [$Bool], false)}, {prop: "OverflowFloat", name: "OverflowFloat", pkg: "", typ: $funcType([$Float64], [$Bool], false)}, {prop: "OverflowInt", name: "OverflowInt", pkg: "", typ: $funcType([$Int64], [$Bool], false)}, {prop: "OverflowUint", name: "OverflowUint", pkg: "", typ: $funcType([$Uint64], [$Bool], false)}, {prop: "Recv", name: "Recv", pkg: "", typ: $funcType([], [Value, $Bool], false)}, {prop: "recv", name: "recv", pkg: "reflect", typ: $funcType([$Bool], [Value, $Bool], false)}, {prop: "Send", name: "Send", pkg: "", typ: $funcType([Value], [], false)}, {prop: "send", name: "send", pkg: "reflect", typ: $funcType([Value, $Bool], [$Bool], false)}, {prop: "SetBool", name: "SetBool", pkg: "", typ: $funcType([$Bool], [], false)}, {prop: "setRunes", name: "setRunes", pkg: "reflect", typ: $funcType([sliceType$15], [], false)}, {prop: "SetComplex", name: "SetComplex", pkg: "", typ: $funcType([$Complex128], [], false)}, {prop: "SetFloat", name: "SetFloat", pkg: "", typ: $funcType([$Float64], [], false)}, {prop: "SetInt", name: "SetInt", pkg: "", typ: $funcType([$Int64], [], false)}, {prop: "SetMapIndex", name: "SetMapIndex", pkg: "", typ: $funcType([Value, Value], [], false)}, {prop: "SetUint", name: "SetUint", pkg: "", typ: $funcType([$Uint64], [], false)}, {prop: "SetPointer", name: "SetPointer", pkg: "", typ: $funcType([$UnsafePointer], [], false)}, {prop: "SetString", name: "SetString", pkg: "", typ: $funcType([$String], [], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}, {prop: "TryRecv", name: "TryRecv", pkg: "", typ: $funcType([], [Value, $Bool], false)}, {prop: "TrySend", name: "TrySend", pkg: "", typ: $funcType([Value], [$Bool], false)}, {prop: "Type", name: "Type", pkg: "", typ: $funcType([], [Type], false)}, {prop: "Uint", name: "Uint", pkg: "", typ: $funcType([], [$Uint64], false)}, {prop: "UnsafeAddr", name: "UnsafeAddr", pkg: "", typ: $funcType([], [$Uintptr], false)}, {prop: "assignTo", name: "assignTo", pkg: "reflect", typ: $funcType([$String, ptrType$1, $UnsafePointer], [Value], false)}, {prop: "Convert", name: "Convert", pkg: "", typ: $funcType([Type], [Value], false)}];
	flag.methods = [{prop: "kind", name: "kind", pkg: "reflect", typ: $funcType([], [Kind], false)}, {prop: "mustBe", name: "mustBe", pkg: "reflect", typ: $funcType([Kind], [], false)}, {prop: "mustBeExported", name: "mustBeExported", pkg: "reflect", typ: $funcType([], [], false)}, {prop: "mustBeAssignable", name: "mustBeAssignable", pkg: "reflect", typ: $funcType([], [], false)}];
	ptrType$20.methods = [{prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}];
	mapIter.init([{prop: "t", name: "t", pkg: "reflect", typ: Type, tag: ""}, {prop: "m", name: "m", pkg: "reflect", typ: ptrType$3, tag: ""}, {prop: "keys", name: "keys", pkg: "reflect", typ: ptrType$3, tag: ""}, {prop: "i", name: "i", pkg: "reflect", typ: $Int, tag: ""}]);
	Type.init([{prop: "Align", name: "Align", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "AssignableTo", name: "AssignableTo", pkg: "", typ: $funcType([Type], [$Bool], false)}, {prop: "Bits", name: "Bits", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "ChanDir", name: "ChanDir", pkg: "", typ: $funcType([], [ChanDir], false)}, {prop: "Comparable", name: "Comparable", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "ConvertibleTo", name: "ConvertibleTo", pkg: "", typ: $funcType([Type], [$Bool], false)}, {prop: "Elem", name: "Elem", pkg: "", typ: $funcType([], [Type], false)}, {prop: "Field", name: "Field", pkg: "", typ: $funcType([$Int], [StructField], false)}, {prop: "FieldAlign", name: "FieldAlign", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "FieldByIndex", name: "FieldByIndex", pkg: "", typ: $funcType([sliceType$11], [StructField], false)}, {prop: "FieldByName", name: "FieldByName", pkg: "", typ: $funcType([$String], [StructField, $Bool], false)}, {prop: "FieldByNameFunc", name: "FieldByNameFunc", pkg: "", typ: $funcType([funcType$3], [StructField, $Bool], false)}, {prop: "Implements", name: "Implements", pkg: "", typ: $funcType([Type], [$Bool], false)}, {prop: "In", name: "In", pkg: "", typ: $funcType([$Int], [Type], false)}, {prop: "IsVariadic", name: "IsVariadic", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "Key", name: "Key", pkg: "", typ: $funcType([], [Type], false)}, {prop: "Kind", name: "Kind", pkg: "", typ: $funcType([], [Kind], false)}, {prop: "Len", name: "Len", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Method", name: "Method", pkg: "", typ: $funcType([$Int], [Method], false)}, {prop: "MethodByName", name: "MethodByName", pkg: "", typ: $funcType([$String], [Method, $Bool], false)}, {prop: "Name", name: "Name", pkg: "", typ: $funcType([], [$String], false)}, {prop: "NumField", name: "NumField", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "NumIn", name: "NumIn", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "NumMethod", name: "NumMethod", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "NumOut", name: "NumOut", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Out", name: "Out", pkg: "", typ: $funcType([$Int], [Type], false)}, {prop: "PkgPath", name: "PkgPath", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Size", name: "Size", pkg: "", typ: $funcType([], [$Uintptr], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}, {prop: "common", name: "common", pkg: "reflect", typ: $funcType([], [ptrType$1], false)}, {prop: "uncommon", name: "uncommon", pkg: "reflect", typ: $funcType([], [ptrType$7], false)}]);
	rtype.init([{prop: "size", name: "size", pkg: "reflect", typ: $Uintptr, tag: ""}, {prop: "ptrdata", name: "ptrdata", pkg: "reflect", typ: $Uintptr, tag: ""}, {prop: "hash", name: "hash", pkg: "reflect", typ: $Uint32, tag: ""}, {prop: "_$3", name: "_", pkg: "reflect", typ: $Uint8, tag: ""}, {prop: "align", name: "align", pkg: "reflect", typ: $Uint8, tag: ""}, {prop: "fieldAlign", name: "fieldAlign", pkg: "reflect", typ: $Uint8, tag: ""}, {prop: "kind", name: "kind", pkg: "reflect", typ: $Uint8, tag: ""}, {prop: "alg", name: "alg", pkg: "reflect", typ: ptrType$4, tag: ""}, {prop: "gcdata", name: "gcdata", pkg: "reflect", typ: ptrType$5, tag: ""}, {prop: "string", name: "string", pkg: "reflect", typ: ptrType$6, tag: ""}, {prop: "uncommonType", name: "", pkg: "reflect", typ: ptrType$7, tag: ""}, {prop: "ptrToThis", name: "ptrToThis", pkg: "reflect", typ: ptrType$1, tag: ""}]);
	typeAlg.init([{prop: "hash", name: "hash", pkg: "reflect", typ: funcType$4, tag: ""}, {prop: "equal", name: "equal", pkg: "reflect", typ: funcType$5, tag: ""}]);
	method.init([{prop: "name", name: "name", pkg: "reflect", typ: ptrType$6, tag: ""}, {prop: "pkgPath", name: "pkgPath", pkg: "reflect", typ: ptrType$6, tag: ""}, {prop: "mtyp", name: "mtyp", pkg: "reflect", typ: ptrType$1, tag: ""}, {prop: "typ", name: "typ", pkg: "reflect", typ: ptrType$1, tag: ""}, {prop: "ifn", name: "ifn", pkg: "reflect", typ: $UnsafePointer, tag: ""}, {prop: "tfn", name: "tfn", pkg: "reflect", typ: $UnsafePointer, tag: ""}]);
	uncommonType.init([{prop: "name", name: "name", pkg: "reflect", typ: ptrType$6, tag: ""}, {prop: "pkgPath", name: "pkgPath", pkg: "reflect", typ: ptrType$6, tag: ""}, {prop: "methods", name: "methods", pkg: "reflect", typ: sliceType$4, tag: ""}]);
	arrayType.init([{prop: "rtype", name: "", pkg: "reflect", typ: rtype, tag: "reflect:\"array\""}, {prop: "elem", name: "elem", pkg: "reflect", typ: ptrType$1, tag: ""}, {prop: "slice", name: "slice", pkg: "reflect", typ: ptrType$1, tag: ""}, {prop: "len", name: "len", pkg: "reflect", typ: $Uintptr, tag: ""}]);
	chanType.init([{prop: "rtype", name: "", pkg: "reflect", typ: rtype, tag: "reflect:\"chan\""}, {prop: "elem", name: "elem", pkg: "reflect", typ: ptrType$1, tag: ""}, {prop: "dir", name: "dir", pkg: "reflect", typ: $Uintptr, tag: ""}]);
	funcType.init([{prop: "rtype", name: "", pkg: "reflect", typ: rtype, tag: "reflect:\"func\""}, {prop: "dotdotdot", name: "dotdotdot", pkg: "reflect", typ: $Bool, tag: ""}, {prop: "in$2", name: "in", pkg: "reflect", typ: sliceType$1, tag: ""}, {prop: "out", name: "out", pkg: "reflect", typ: sliceType$1, tag: ""}]);
	imethod.init([{prop: "name", name: "name", pkg: "reflect", typ: ptrType$6, tag: ""}, {prop: "pkgPath", name: "pkgPath", pkg: "reflect", typ: ptrType$6, tag: ""}, {prop: "typ", name: "typ", pkg: "reflect", typ: ptrType$1, tag: ""}]);
	interfaceType.init([{prop: "rtype", name: "", pkg: "reflect", typ: rtype, tag: "reflect:\"interface\""}, {prop: "methods", name: "methods", pkg: "reflect", typ: sliceType$5, tag: ""}]);
	mapType.init([{prop: "rtype", name: "", pkg: "reflect", typ: rtype, tag: "reflect:\"map\""}, {prop: "key", name: "key", pkg: "reflect", typ: ptrType$1, tag: ""}, {prop: "elem", name: "elem", pkg: "reflect", typ: ptrType$1, tag: ""}, {prop: "bucket", name: "bucket", pkg: "reflect", typ: ptrType$1, tag: ""}, {prop: "hmap", name: "hmap", pkg: "reflect", typ: ptrType$1, tag: ""}, {prop: "keysize", name: "keysize", pkg: "reflect", typ: $Uint8, tag: ""}, {prop: "indirectkey", name: "indirectkey", pkg: "reflect", typ: $Uint8, tag: ""}, {prop: "valuesize", name: "valuesize", pkg: "reflect", typ: $Uint8, tag: ""}, {prop: "indirectvalue", name: "indirectvalue", pkg: "reflect", typ: $Uint8, tag: ""}, {prop: "bucketsize", name: "bucketsize", pkg: "reflect", typ: $Uint16, tag: ""}, {prop: "reflexivekey", name: "reflexivekey", pkg: "reflect", typ: $Bool, tag: ""}, {prop: "needkeyupdate", name: "needkeyupdate", pkg: "reflect", typ: $Bool, tag: ""}]);
	ptrType.init([{prop: "rtype", name: "", pkg: "reflect", typ: rtype, tag: "reflect:\"ptr\""}, {prop: "elem", name: "elem", pkg: "reflect", typ: ptrType$1, tag: ""}]);
	sliceType.init([{prop: "rtype", name: "", pkg: "reflect", typ: rtype, tag: "reflect:\"slice\""}, {prop: "elem", name: "elem", pkg: "reflect", typ: ptrType$1, tag: ""}]);
	structField.init([{prop: "name", name: "name", pkg: "reflect", typ: ptrType$6, tag: ""}, {prop: "pkgPath", name: "pkgPath", pkg: "reflect", typ: ptrType$6, tag: ""}, {prop: "typ", name: "typ", pkg: "reflect", typ: ptrType$1, tag: ""}, {prop: "tag", name: "tag", pkg: "reflect", typ: ptrType$6, tag: ""}, {prop: "offset", name: "offset", pkg: "reflect", typ: $Uintptr, tag: ""}]);
	structType.init([{prop: "rtype", name: "", pkg: "reflect", typ: rtype, tag: "reflect:\"struct\""}, {prop: "fields", name: "fields", pkg: "reflect", typ: sliceType$6, tag: ""}]);
	Method.init([{prop: "Name", name: "Name", pkg: "", typ: $String, tag: ""}, {prop: "PkgPath", name: "PkgPath", pkg: "", typ: $String, tag: ""}, {prop: "Type", name: "Type", pkg: "", typ: Type, tag: ""}, {prop: "Func", name: "Func", pkg: "", typ: Value, tag: ""}, {prop: "Index", name: "Index", pkg: "", typ: $Int, tag: ""}]);
	StructField.init([{prop: "Name", name: "Name", pkg: "", typ: $String, tag: ""}, {prop: "PkgPath", name: "PkgPath", pkg: "", typ: $String, tag: ""}, {prop: "Type", name: "Type", pkg: "", typ: Type, tag: ""}, {prop: "Tag", name: "Tag", pkg: "", typ: StructTag, tag: ""}, {prop: "Offset", name: "Offset", pkg: "", typ: $Uintptr, tag: ""}, {prop: "Index", name: "Index", pkg: "", typ: sliceType$11, tag: ""}, {prop: "Anonymous", name: "Anonymous", pkg: "", typ: $Bool, tag: ""}]);
	fieldScan.init([{prop: "typ", name: "typ", pkg: "reflect", typ: ptrType$13, tag: ""}, {prop: "index", name: "index", pkg: "reflect", typ: sliceType$11, tag: ""}]);
	Value.init([{prop: "typ", name: "typ", pkg: "reflect", typ: ptrType$1, tag: ""}, {prop: "ptr", name: "ptr", pkg: "reflect", typ: $UnsafePointer, tag: ""}, {prop: "flag", name: "", pkg: "reflect", typ: flag, tag: ""}]);
	ValueError.init([{prop: "Method", name: "Method", pkg: "", typ: $String, tag: ""}, {prop: "Kind", name: "Kind", pkg: "", typ: Kind, tag: ""}]);
	nonEmptyInterface.init([{prop: "itab", name: "itab", pkg: "reflect", typ: ptrType$9, tag: ""}, {prop: "word", name: "word", pkg: "reflect", typ: $UnsafePointer, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = errors.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = js.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = math.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = runtime.$init(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = strconv.$init(); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = sync.$init(); /* */ $s = 6; case 6: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		initialized = false;
		stringPtrMap = {};
		callHelper = $assertType($internalize($call, $emptyInterface), funcType$1);
		selectHelper = $assertType($internalize($select, $emptyInterface), funcType$1);
		kindNames = new sliceType$3(["invalid", "bool", "int", "int8", "int16", "int32", "int64", "uint", "uint8", "uint16", "uint32", "uint64", "uintptr", "float32", "float64", "complex64", "complex128", "array", "chan", "func", "interface", "map", "ptr", "slice", "string", "struct", "unsafe.Pointer"]);
		jsObjectPtr = reflectType($jsObjectPtr);
		uint8Type = $assertType(TypeOf(new $Uint8(0)), ptrType$1);
		$r = init(); /* */ $s = 7; case 7: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["io"] = (function() {
	var $pkg = {}, $init, errors, sync, errWhence, errOffset;
	errors = $packages["errors"];
	sync = $packages["sync"];
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = errors.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = sync.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$pkg.ErrShortWrite = errors.New("short write");
		$pkg.ErrShortBuffer = errors.New("short buffer");
		$pkg.EOF = errors.New("EOF");
		$pkg.ErrUnexpectedEOF = errors.New("unexpected EOF");
		$pkg.ErrNoProgress = errors.New("multiple Read calls return no data or error");
		errWhence = errors.New("Seek: invalid whence");
		errOffset = errors.New("Seek: invalid offset");
		$pkg.ErrClosedPipe = errors.New("io: read/write on closed pipe");
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["unicode"] = (function() {
	var $pkg = {}, $init, CaseRange, d, arrayType, sliceType$3, _CaseRanges, to, To, ToLower;
	CaseRange = $pkg.CaseRange = $newType(0, $kindStruct, "unicode.CaseRange", "CaseRange", "unicode", function(Lo_, Hi_, Delta_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Lo = 0;
			this.Hi = 0;
			this.Delta = arrayType.zero();
			return;
		}
		this.Lo = Lo_;
		this.Hi = Hi_;
		this.Delta = Delta_;
	});
	d = $pkg.d = $newType(12, $kindArray, "unicode.d", "d", "unicode", null);
	arrayType = $arrayType($Int32, 3);
	sliceType$3 = $sliceType(CaseRange);
	to = function(_case, r, caseRange) {
		var $ptr, _case, _q, caseRange, cr, delta, hi, lo, m, r, x;
		if (_case < 0 || 3 <= _case) {
			return 65533;
		}
		lo = 0;
		hi = caseRange.$length;
		while (true) {
			if (!(lo < hi)) { break; }
			m = lo + (_q = ((hi - lo >> 0)) / 2, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero")) >> 0;
			cr = ((m < 0 || m >= caseRange.$length) ? $throwRuntimeError("index out of range") : caseRange.$array[caseRange.$offset + m]);
			if ((cr.Lo >> 0) <= r && r <= (cr.Hi >> 0)) {
				delta = (x = cr.Delta, ((_case < 0 || _case >= x.length) ? $throwRuntimeError("index out of range") : x[_case]));
				if (delta > 1114111) {
					return (cr.Lo >> 0) + ((((((r - (cr.Lo >> 0) >> 0)) & ~1) >> 0) | ((_case & 1) >> 0))) >> 0;
				}
				return r + delta >> 0;
			}
			if (r < (cr.Lo >> 0)) {
				hi = m;
			} else {
				lo = m + 1 >> 0;
			}
		}
		return r;
	};
	To = function(_case, r) {
		var $ptr, _case, r;
		return to(_case, r, $pkg.CaseRanges);
	};
	$pkg.To = To;
	ToLower = function(r) {
		var $ptr, r;
		if (r <= 127) {
			if (65 <= r && r <= 90) {
				r = r + (32) >> 0;
			}
			return r;
		}
		return To(1, r);
	};
	$pkg.ToLower = ToLower;
	CaseRange.init([{prop: "Lo", name: "Lo", pkg: "", typ: $Uint32, tag: ""}, {prop: "Hi", name: "Hi", pkg: "", typ: $Uint32, tag: ""}, {prop: "Delta", name: "Delta", pkg: "", typ: d, tag: ""}]);
	d.init($Int32, 3);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_CaseRanges = new sliceType$3([new CaseRange.ptr(65, 90, $toNativeArray($kindInt32, [0, 32, 0])), new CaseRange.ptr(97, 122, $toNativeArray($kindInt32, [-32, 0, -32])), new CaseRange.ptr(181, 181, $toNativeArray($kindInt32, [743, 0, 743])), new CaseRange.ptr(192, 214, $toNativeArray($kindInt32, [0, 32, 0])), new CaseRange.ptr(216, 222, $toNativeArray($kindInt32, [0, 32, 0])), new CaseRange.ptr(224, 246, $toNativeArray($kindInt32, [-32, 0, -32])), new CaseRange.ptr(248, 254, $toNativeArray($kindInt32, [-32, 0, -32])), new CaseRange.ptr(255, 255, $toNativeArray($kindInt32, [121, 0, 121])), new CaseRange.ptr(256, 303, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(304, 304, $toNativeArray($kindInt32, [0, -199, 0])), new CaseRange.ptr(305, 305, $toNativeArray($kindInt32, [-232, 0, -232])), new CaseRange.ptr(306, 311, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(313, 328, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(330, 375, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(376, 376, $toNativeArray($kindInt32, [0, -121, 0])), new CaseRange.ptr(377, 382, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(383, 383, $toNativeArray($kindInt32, [-300, 0, -300])), new CaseRange.ptr(384, 384, $toNativeArray($kindInt32, [195, 0, 195])), new CaseRange.ptr(385, 385, $toNativeArray($kindInt32, [0, 210, 0])), new CaseRange.ptr(386, 389, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(390, 390, $toNativeArray($kindInt32, [0, 206, 0])), new CaseRange.ptr(391, 392, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(393, 394, $toNativeArray($kindInt32, [0, 205, 0])), new CaseRange.ptr(395, 396, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(398, 398, $toNativeArray($kindInt32, [0, 79, 0])), new CaseRange.ptr(399, 399, $toNativeArray($kindInt32, [0, 202, 0])), new CaseRange.ptr(400, 400, $toNativeArray($kindInt32, [0, 203, 0])), new CaseRange.ptr(401, 402, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(403, 403, $toNativeArray($kindInt32, [0, 205, 0])), new CaseRange.ptr(404, 404, $toNativeArray($kindInt32, [0, 207, 0])), new CaseRange.ptr(405, 405, $toNativeArray($kindInt32, [97, 0, 97])), new CaseRange.ptr(406, 406, $toNativeArray($kindInt32, [0, 211, 0])), new CaseRange.ptr(407, 407, $toNativeArray($kindInt32, [0, 209, 0])), new CaseRange.ptr(408, 409, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(410, 410, $toNativeArray($kindInt32, [163, 0, 163])), new CaseRange.ptr(412, 412, $toNativeArray($kindInt32, [0, 211, 0])), new CaseRange.ptr(413, 413, $toNativeArray($kindInt32, [0, 213, 0])), new CaseRange.ptr(414, 414, $toNativeArray($kindInt32, [130, 0, 130])), new CaseRange.ptr(415, 415, $toNativeArray($kindInt32, [0, 214, 0])), new CaseRange.ptr(416, 421, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(422, 422, $toNativeArray($kindInt32, [0, 218, 0])), new CaseRange.ptr(423, 424, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(425, 425, $toNativeArray($kindInt32, [0, 218, 0])), new CaseRange.ptr(428, 429, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(430, 430, $toNativeArray($kindInt32, [0, 218, 0])), new CaseRange.ptr(431, 432, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(433, 434, $toNativeArray($kindInt32, [0, 217, 0])), new CaseRange.ptr(435, 438, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(439, 439, $toNativeArray($kindInt32, [0, 219, 0])), new CaseRange.ptr(440, 441, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(444, 445, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(447, 447, $toNativeArray($kindInt32, [56, 0, 56])), new CaseRange.ptr(452, 452, $toNativeArray($kindInt32, [0, 2, 1])), new CaseRange.ptr(453, 453, $toNativeArray($kindInt32, [-1, 1, 0])), new CaseRange.ptr(454, 454, $toNativeArray($kindInt32, [-2, 0, -1])), new CaseRange.ptr(455, 455, $toNativeArray($kindInt32, [0, 2, 1])), new CaseRange.ptr(456, 456, $toNativeArray($kindInt32, [-1, 1, 0])), new CaseRange.ptr(457, 457, $toNativeArray($kindInt32, [-2, 0, -1])), new CaseRange.ptr(458, 458, $toNativeArray($kindInt32, [0, 2, 1])), new CaseRange.ptr(459, 459, $toNativeArray($kindInt32, [-1, 1, 0])), new CaseRange.ptr(460, 460, $toNativeArray($kindInt32, [-2, 0, -1])), new CaseRange.ptr(461, 476, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(477, 477, $toNativeArray($kindInt32, [-79, 0, -79])), new CaseRange.ptr(478, 495, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(497, 497, $toNativeArray($kindInt32, [0, 2, 1])), new CaseRange.ptr(498, 498, $toNativeArray($kindInt32, [-1, 1, 0])), new CaseRange.ptr(499, 499, $toNativeArray($kindInt32, [-2, 0, -1])), new CaseRange.ptr(500, 501, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(502, 502, $toNativeArray($kindInt32, [0, -97, 0])), new CaseRange.ptr(503, 503, $toNativeArray($kindInt32, [0, -56, 0])), new CaseRange.ptr(504, 543, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(544, 544, $toNativeArray($kindInt32, [0, -130, 0])), new CaseRange.ptr(546, 563, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(570, 570, $toNativeArray($kindInt32, [0, 10795, 0])), new CaseRange.ptr(571, 572, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(573, 573, $toNativeArray($kindInt32, [0, -163, 0])), new CaseRange.ptr(574, 574, $toNativeArray($kindInt32, [0, 10792, 0])), new CaseRange.ptr(575, 576, $toNativeArray($kindInt32, [10815, 0, 10815])), new CaseRange.ptr(577, 578, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(579, 579, $toNativeArray($kindInt32, [0, -195, 0])), new CaseRange.ptr(580, 580, $toNativeArray($kindInt32, [0, 69, 0])), new CaseRange.ptr(581, 581, $toNativeArray($kindInt32, [0, 71, 0])), new CaseRange.ptr(582, 591, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(592, 592, $toNativeArray($kindInt32, [10783, 0, 10783])), new CaseRange.ptr(593, 593, $toNativeArray($kindInt32, [10780, 0, 10780])), new CaseRange.ptr(594, 594, $toNativeArray($kindInt32, [10782, 0, 10782])), new CaseRange.ptr(595, 595, $toNativeArray($kindInt32, [-210, 0, -210])), new CaseRange.ptr(596, 596, $toNativeArray($kindInt32, [-206, 0, -206])), new CaseRange.ptr(598, 599, $toNativeArray($kindInt32, [-205, 0, -205])), new CaseRange.ptr(601, 601, $toNativeArray($kindInt32, [-202, 0, -202])), new CaseRange.ptr(603, 603, $toNativeArray($kindInt32, [-203, 0, -203])), new CaseRange.ptr(604, 604, $toNativeArray($kindInt32, [42319, 0, 42319])), new CaseRange.ptr(608, 608, $toNativeArray($kindInt32, [-205, 0, -205])), new CaseRange.ptr(609, 609, $toNativeArray($kindInt32, [42315, 0, 42315])), new CaseRange.ptr(611, 611, $toNativeArray($kindInt32, [-207, 0, -207])), new CaseRange.ptr(613, 613, $toNativeArray($kindInt32, [42280, 0, 42280])), new CaseRange.ptr(614, 614, $toNativeArray($kindInt32, [42308, 0, 42308])), new CaseRange.ptr(616, 616, $toNativeArray($kindInt32, [-209, 0, -209])), new CaseRange.ptr(617, 617, $toNativeArray($kindInt32, [-211, 0, -211])), new CaseRange.ptr(619, 619, $toNativeArray($kindInt32, [10743, 0, 10743])), new CaseRange.ptr(620, 620, $toNativeArray($kindInt32, [42305, 0, 42305])), new CaseRange.ptr(623, 623, $toNativeArray($kindInt32, [-211, 0, -211])), new CaseRange.ptr(625, 625, $toNativeArray($kindInt32, [10749, 0, 10749])), new CaseRange.ptr(626, 626, $toNativeArray($kindInt32, [-213, 0, -213])), new CaseRange.ptr(629, 629, $toNativeArray($kindInt32, [-214, 0, -214])), new CaseRange.ptr(637, 637, $toNativeArray($kindInt32, [10727, 0, 10727])), new CaseRange.ptr(640, 640, $toNativeArray($kindInt32, [-218, 0, -218])), new CaseRange.ptr(643, 643, $toNativeArray($kindInt32, [-218, 0, -218])), new CaseRange.ptr(647, 647, $toNativeArray($kindInt32, [42282, 0, 42282])), new CaseRange.ptr(648, 648, $toNativeArray($kindInt32, [-218, 0, -218])), new CaseRange.ptr(649, 649, $toNativeArray($kindInt32, [-69, 0, -69])), new CaseRange.ptr(650, 651, $toNativeArray($kindInt32, [-217, 0, -217])), new CaseRange.ptr(652, 652, $toNativeArray($kindInt32, [-71, 0, -71])), new CaseRange.ptr(658, 658, $toNativeArray($kindInt32, [-219, 0, -219])), new CaseRange.ptr(669, 669, $toNativeArray($kindInt32, [42261, 0, 42261])), new CaseRange.ptr(670, 670, $toNativeArray($kindInt32, [42258, 0, 42258])), new CaseRange.ptr(837, 837, $toNativeArray($kindInt32, [84, 0, 84])), new CaseRange.ptr(880, 883, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(886, 887, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(891, 893, $toNativeArray($kindInt32, [130, 0, 130])), new CaseRange.ptr(895, 895, $toNativeArray($kindInt32, [0, 116, 0])), new CaseRange.ptr(902, 902, $toNativeArray($kindInt32, [0, 38, 0])), new CaseRange.ptr(904, 906, $toNativeArray($kindInt32, [0, 37, 0])), new CaseRange.ptr(908, 908, $toNativeArray($kindInt32, [0, 64, 0])), new CaseRange.ptr(910, 911, $toNativeArray($kindInt32, [0, 63, 0])), new CaseRange.ptr(913, 929, $toNativeArray($kindInt32, [0, 32, 0])), new CaseRange.ptr(931, 939, $toNativeArray($kindInt32, [0, 32, 0])), new CaseRange.ptr(940, 940, $toNativeArray($kindInt32, [-38, 0, -38])), new CaseRange.ptr(941, 943, $toNativeArray($kindInt32, [-37, 0, -37])), new CaseRange.ptr(945, 961, $toNativeArray($kindInt32, [-32, 0, -32])), new CaseRange.ptr(962, 962, $toNativeArray($kindInt32, [-31, 0, -31])), new CaseRange.ptr(963, 971, $toNativeArray($kindInt32, [-32, 0, -32])), new CaseRange.ptr(972, 972, $toNativeArray($kindInt32, [-64, 0, -64])), new CaseRange.ptr(973, 974, $toNativeArray($kindInt32, [-63, 0, -63])), new CaseRange.ptr(975, 975, $toNativeArray($kindInt32, [0, 8, 0])), new CaseRange.ptr(976, 976, $toNativeArray($kindInt32, [-62, 0, -62])), new CaseRange.ptr(977, 977, $toNativeArray($kindInt32, [-57, 0, -57])), new CaseRange.ptr(981, 981, $toNativeArray($kindInt32, [-47, 0, -47])), new CaseRange.ptr(982, 982, $toNativeArray($kindInt32, [-54, 0, -54])), new CaseRange.ptr(983, 983, $toNativeArray($kindInt32, [-8, 0, -8])), new CaseRange.ptr(984, 1007, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(1008, 1008, $toNativeArray($kindInt32, [-86, 0, -86])), new CaseRange.ptr(1009, 1009, $toNativeArray($kindInt32, [-80, 0, -80])), new CaseRange.ptr(1010, 1010, $toNativeArray($kindInt32, [7, 0, 7])), new CaseRange.ptr(1011, 1011, $toNativeArray($kindInt32, [-116, 0, -116])), new CaseRange.ptr(1012, 1012, $toNativeArray($kindInt32, [0, -60, 0])), new CaseRange.ptr(1013, 1013, $toNativeArray($kindInt32, [-96, 0, -96])), new CaseRange.ptr(1015, 1016, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(1017, 1017, $toNativeArray($kindInt32, [0, -7, 0])), new CaseRange.ptr(1018, 1019, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(1021, 1023, $toNativeArray($kindInt32, [0, -130, 0])), new CaseRange.ptr(1024, 1039, $toNativeArray($kindInt32, [0, 80, 0])), new CaseRange.ptr(1040, 1071, $toNativeArray($kindInt32, [0, 32, 0])), new CaseRange.ptr(1072, 1103, $toNativeArray($kindInt32, [-32, 0, -32])), new CaseRange.ptr(1104, 1119, $toNativeArray($kindInt32, [-80, 0, -80])), new CaseRange.ptr(1120, 1153, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(1162, 1215, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(1216, 1216, $toNativeArray($kindInt32, [0, 15, 0])), new CaseRange.ptr(1217, 1230, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(1231, 1231, $toNativeArray($kindInt32, [-15, 0, -15])), new CaseRange.ptr(1232, 1327, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(1329, 1366, $toNativeArray($kindInt32, [0, 48, 0])), new CaseRange.ptr(1377, 1414, $toNativeArray($kindInt32, [-48, 0, -48])), new CaseRange.ptr(4256, 4293, $toNativeArray($kindInt32, [0, 7264, 0])), new CaseRange.ptr(4295, 4295, $toNativeArray($kindInt32, [0, 7264, 0])), new CaseRange.ptr(4301, 4301, $toNativeArray($kindInt32, [0, 7264, 0])), new CaseRange.ptr(5024, 5103, $toNativeArray($kindInt32, [0, 38864, 0])), new CaseRange.ptr(5104, 5109, $toNativeArray($kindInt32, [0, 8, 0])), new CaseRange.ptr(5112, 5117, $toNativeArray($kindInt32, [-8, 0, -8])), new CaseRange.ptr(7545, 7545, $toNativeArray($kindInt32, [35332, 0, 35332])), new CaseRange.ptr(7549, 7549, $toNativeArray($kindInt32, [3814, 0, 3814])), new CaseRange.ptr(7680, 7829, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(7835, 7835, $toNativeArray($kindInt32, [-59, 0, -59])), new CaseRange.ptr(7838, 7838, $toNativeArray($kindInt32, [0, -7615, 0])), new CaseRange.ptr(7840, 7935, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(7936, 7943, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(7944, 7951, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(7952, 7957, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(7960, 7965, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(7968, 7975, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(7976, 7983, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(7984, 7991, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(7992, 7999, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(8000, 8005, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(8008, 8013, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(8017, 8017, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(8019, 8019, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(8021, 8021, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(8023, 8023, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(8025, 8025, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(8027, 8027, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(8029, 8029, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(8031, 8031, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(8032, 8039, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(8040, 8047, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(8048, 8049, $toNativeArray($kindInt32, [74, 0, 74])), new CaseRange.ptr(8050, 8053, $toNativeArray($kindInt32, [86, 0, 86])), new CaseRange.ptr(8054, 8055, $toNativeArray($kindInt32, [100, 0, 100])), new CaseRange.ptr(8056, 8057, $toNativeArray($kindInt32, [128, 0, 128])), new CaseRange.ptr(8058, 8059, $toNativeArray($kindInt32, [112, 0, 112])), new CaseRange.ptr(8060, 8061, $toNativeArray($kindInt32, [126, 0, 126])), new CaseRange.ptr(8064, 8071, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(8072, 8079, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(8080, 8087, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(8088, 8095, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(8096, 8103, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(8104, 8111, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(8112, 8113, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(8115, 8115, $toNativeArray($kindInt32, [9, 0, 9])), new CaseRange.ptr(8120, 8121, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(8122, 8123, $toNativeArray($kindInt32, [0, -74, 0])), new CaseRange.ptr(8124, 8124, $toNativeArray($kindInt32, [0, -9, 0])), new CaseRange.ptr(8126, 8126, $toNativeArray($kindInt32, [-7205, 0, -7205])), new CaseRange.ptr(8131, 8131, $toNativeArray($kindInt32, [9, 0, 9])), new CaseRange.ptr(8136, 8139, $toNativeArray($kindInt32, [0, -86, 0])), new CaseRange.ptr(8140, 8140, $toNativeArray($kindInt32, [0, -9, 0])), new CaseRange.ptr(8144, 8145, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(8152, 8153, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(8154, 8155, $toNativeArray($kindInt32, [0, -100, 0])), new CaseRange.ptr(8160, 8161, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(8165, 8165, $toNativeArray($kindInt32, [7, 0, 7])), new CaseRange.ptr(8168, 8169, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(8170, 8171, $toNativeArray($kindInt32, [0, -112, 0])), new CaseRange.ptr(8172, 8172, $toNativeArray($kindInt32, [0, -7, 0])), new CaseRange.ptr(8179, 8179, $toNativeArray($kindInt32, [9, 0, 9])), new CaseRange.ptr(8184, 8185, $toNativeArray($kindInt32, [0, -128, 0])), new CaseRange.ptr(8186, 8187, $toNativeArray($kindInt32, [0, -126, 0])), new CaseRange.ptr(8188, 8188, $toNativeArray($kindInt32, [0, -9, 0])), new CaseRange.ptr(8486, 8486, $toNativeArray($kindInt32, [0, -7517, 0])), new CaseRange.ptr(8490, 8490, $toNativeArray($kindInt32, [0, -8383, 0])), new CaseRange.ptr(8491, 8491, $toNativeArray($kindInt32, [0, -8262, 0])), new CaseRange.ptr(8498, 8498, $toNativeArray($kindInt32, [0, 28, 0])), new CaseRange.ptr(8526, 8526, $toNativeArray($kindInt32, [-28, 0, -28])), new CaseRange.ptr(8544, 8559, $toNativeArray($kindInt32, [0, 16, 0])), new CaseRange.ptr(8560, 8575, $toNativeArray($kindInt32, [-16, 0, -16])), new CaseRange.ptr(8579, 8580, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(9398, 9423, $toNativeArray($kindInt32, [0, 26, 0])), new CaseRange.ptr(9424, 9449, $toNativeArray($kindInt32, [-26, 0, -26])), new CaseRange.ptr(11264, 11310, $toNativeArray($kindInt32, [0, 48, 0])), new CaseRange.ptr(11312, 11358, $toNativeArray($kindInt32, [-48, 0, -48])), new CaseRange.ptr(11360, 11361, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(11362, 11362, $toNativeArray($kindInt32, [0, -10743, 0])), new CaseRange.ptr(11363, 11363, $toNativeArray($kindInt32, [0, -3814, 0])), new CaseRange.ptr(11364, 11364, $toNativeArray($kindInt32, [0, -10727, 0])), new CaseRange.ptr(11365, 11365, $toNativeArray($kindInt32, [-10795, 0, -10795])), new CaseRange.ptr(11366, 11366, $toNativeArray($kindInt32, [-10792, 0, -10792])), new CaseRange.ptr(11367, 11372, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(11373, 11373, $toNativeArray($kindInt32, [0, -10780, 0])), new CaseRange.ptr(11374, 11374, $toNativeArray($kindInt32, [0, -10749, 0])), new CaseRange.ptr(11375, 11375, $toNativeArray($kindInt32, [0, -10783, 0])), new CaseRange.ptr(11376, 11376, $toNativeArray($kindInt32, [0, -10782, 0])), new CaseRange.ptr(11378, 11379, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(11381, 11382, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(11390, 11391, $toNativeArray($kindInt32, [0, -10815, 0])), new CaseRange.ptr(11392, 11491, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(11499, 11502, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(11506, 11507, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(11520, 11557, $toNativeArray($kindInt32, [-7264, 0, -7264])), new CaseRange.ptr(11559, 11559, $toNativeArray($kindInt32, [-7264, 0, -7264])), new CaseRange.ptr(11565, 11565, $toNativeArray($kindInt32, [-7264, 0, -7264])), new CaseRange.ptr(42560, 42605, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(42624, 42651, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(42786, 42799, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(42802, 42863, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(42873, 42876, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(42877, 42877, $toNativeArray($kindInt32, [0, -35332, 0])), new CaseRange.ptr(42878, 42887, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(42891, 42892, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(42893, 42893, $toNativeArray($kindInt32, [0, -42280, 0])), new CaseRange.ptr(42896, 42899, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(42902, 42921, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(42922, 42922, $toNativeArray($kindInt32, [0, -42308, 0])), new CaseRange.ptr(42923, 42923, $toNativeArray($kindInt32, [0, -42319, 0])), new CaseRange.ptr(42924, 42924, $toNativeArray($kindInt32, [0, -42315, 0])), new CaseRange.ptr(42925, 42925, $toNativeArray($kindInt32, [0, -42305, 0])), new CaseRange.ptr(42928, 42928, $toNativeArray($kindInt32, [0, -42258, 0])), new CaseRange.ptr(42929, 42929, $toNativeArray($kindInt32, [0, -42282, 0])), new CaseRange.ptr(42930, 42930, $toNativeArray($kindInt32, [0, -42261, 0])), new CaseRange.ptr(42931, 42931, $toNativeArray($kindInt32, [0, 928, 0])), new CaseRange.ptr(42932, 42935, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(43859, 43859, $toNativeArray($kindInt32, [-928, 0, -928])), new CaseRange.ptr(43888, 43967, $toNativeArray($kindInt32, [-38864, 0, -38864])), new CaseRange.ptr(65313, 65338, $toNativeArray($kindInt32, [0, 32, 0])), new CaseRange.ptr(65345, 65370, $toNativeArray($kindInt32, [-32, 0, -32])), new CaseRange.ptr(66560, 66599, $toNativeArray($kindInt32, [0, 40, 0])), new CaseRange.ptr(66600, 66639, $toNativeArray($kindInt32, [-40, 0, -40])), new CaseRange.ptr(68736, 68786, $toNativeArray($kindInt32, [0, 64, 0])), new CaseRange.ptr(68800, 68850, $toNativeArray($kindInt32, [-64, 0, -64])), new CaseRange.ptr(71840, 71871, $toNativeArray($kindInt32, [0, 32, 0])), new CaseRange.ptr(71872, 71903, $toNativeArray($kindInt32, [-32, 0, -32]))]);
		$pkg.CaseRanges = _CaseRanges;
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["strings"] = (function() {
	var $pkg = {}, $init, errors, js, io, unicode, utf8, sliceType, Compare, Map, ToLower;
	errors = $packages["errors"];
	js = $packages["github.com/gopherjs/gopherjs/js"];
	io = $packages["io"];
	unicode = $packages["unicode"];
	utf8 = $packages["unicode/utf8"];
	sliceType = $sliceType($Uint8);
	Compare = function(a, b) {
		var $ptr, a, b;
		if (a === b) {
			return 0;
		}
		if (a < b) {
			return -1;
		}
		return 1;
	};
	$pkg.Compare = Compare;
	Map = function(mapping, s) {
		var $ptr, _i, _r, _ref, _rune, b, c, i, mapping, maxbytes, nb, nbytes, r, s, wid, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _i = $f._i; _r = $f._r; _ref = $f._ref; _rune = $f._rune; b = $f.b; c = $f.c; i = $f.i; mapping = $f.mapping; maxbytes = $f.maxbytes; nb = $f.nb; nbytes = $f.nbytes; r = $f.r; s = $f.s; wid = $f.wid; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		maxbytes = s.length;
		nbytes = 0;
		b = sliceType.nil;
		_ref = s;
		_i = 0;
		/* while (true) { */ case 1:
			/* if (!(_i < _ref.length)) { break; } */ if(!(_i < _ref.length)) { $s = 2; continue; }
			_rune = $decodeRune(_ref, _i);
			i = _i;
			c = _rune[0];
			_r = mapping(c); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			r = _r;
			if (b === sliceType.nil) {
				if (r === c) {
					_i += _rune[1];
					/* continue; */ $s = 1; continue;
				}
				b = $makeSlice(sliceType, maxbytes);
				nbytes = $copyString(b, s.substring(0, i));
			}
			if (r >= 0) {
				wid = 1;
				if (r >= 128) {
					wid = utf8.RuneLen(r);
				}
				if ((nbytes + wid >> 0) > maxbytes) {
					maxbytes = ($imul(maxbytes, 2)) + 4 >> 0;
					nb = $makeSlice(sliceType, maxbytes);
					$copySlice(nb, $subslice(b, 0, nbytes));
					b = nb;
				}
				nbytes = nbytes + (utf8.EncodeRune($subslice(b, nbytes, maxbytes), r)) >> 0;
			}
			_i += _rune[1];
		/* } */ $s = 1; continue; case 2:
		if (b === sliceType.nil) {
			return s;
		}
		return $bytesToString($subslice(b, 0, nbytes));
		/* */ } return; } if ($f === undefined) { $f = { $blk: Map }; } $f.$ptr = $ptr; $f._i = _i; $f._r = _r; $f._ref = _ref; $f._rune = _rune; $f.b = b; $f.c = c; $f.i = i; $f.mapping = mapping; $f.maxbytes = maxbytes; $f.nb = nb; $f.nbytes = nbytes; $f.r = r; $f.s = s; $f.wid = wid; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.Map = Map;
	ToLower = function(s) {
		var $ptr, _r, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = Map(unicode.ToLower, s); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: ToLower }; } $f.$ptr = $ptr; $f._r = _r; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.ToLower = ToLower;
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = errors.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = js.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = io.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = unicode.$init(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = utf8.$init(); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["github.com/ninchat/ninchat-go/ninchatmodel"] = (function() {
	var $pkg = {}, $init, errors, ninchat, ninchatapi, reflect, sort, strings, atomic, Aux, Change, Dialogue, DialogueState, messageGroup, MessageWindow, MessageState, SelfState, SettingsState, State, User, UserState, mapType, ptrType, ptrType$1, sliceType, ptrType$2, sliceType$1, sliceType$2, ptrType$3, ptrType$4, ptrType$5, ptrType$6, ptrType$7, ptrType$8, ptrType$9, ptrType$10, ptrType$11, ptrType$12, ptrType$13, ptrType$14, ptrType$15, ptrType$16, ptrType$17, mapType$1, ptrType$18, ptrType$19, mapType$2, chanType, ptrType$20, funcType, mapType$3, ptrType$21, ptrType$22, funcType$1, funcType$2, ptrType$23, funcType$3, ptrType$24, funcType$4, ptrType$25, sliceType$3, ptrType$26, ptrType$27, funcType$5, ptrType$28, funcType$6, mapType$4, numericStatuses, log, compareStatus, newUser;
	errors = $packages["errors"];
	ninchat = $packages["github.com/ninchat/ninchat-go"];
	ninchatapi = $packages["github.com/ninchat/ninchat-go/ninchatapi"];
	reflect = $packages["reflect"];
	sort = $packages["sort"];
	strings = $packages["strings"];
	atomic = $packages["sync/atomic"];
	Aux = $pkg.Aux = $newType(0, $kindStruct, "ninchatmodel.Aux", "Aux", "github.com/ninchat/ninchat-go/ninchatmodel", function(m_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.m = false;
			return;
		}
		this.m = m_;
	});
	Change = $pkg.Change = $newType(4, $kindInt, "ninchatmodel.Change", "Change", "github.com/ninchat/ninchat-go/ninchatmodel", null);
	Dialogue = $pkg.Dialogue = $newType(0, $kindStruct, "ninchatmodel.Dialogue", "Dialogue", "github.com/ninchat/ninchat-go/ninchatmodel", function(PeerId_, Status_, SelfMemberAttrs_, PeerMemberAttrs_, AudienceMetadata_, Window_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.PeerId = "";
			this.Status = "";
			this.SelfMemberAttrs = ptrType$4.nil;
			this.PeerMemberAttrs = ptrType$4.nil;
			this.AudienceMetadata = false;
			this.Window = new MessageWindow.ptr(new Aux.ptr(false), false, false, "", sliceType.nil, "", "", 0);
			return;
		}
		this.PeerId = PeerId_;
		this.Status = Status_;
		this.SelfMemberAttrs = SelfMemberAttrs_;
		this.PeerMemberAttrs = PeerMemberAttrs_;
		this.AudienceMetadata = AudienceMetadata_;
		this.Window = Window_;
	});
	DialogueState = $pkg.DialogueState = $newType(0, $kindStruct, "ninchatmodel.DialogueState", "DialogueState", "github.com/ninchat/ninchat-go/ninchatmodel", function(Messages_, OnChange_, Map_, session_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Messages = new MessageState.ptr($throwNilPointerError, $throwNilPointerError, ptrType$19.nil, "");
			this.OnChange = $throwNilPointerError;
			this.Map = false;
			this.session = ptrType$19.nil;
			return;
		}
		this.Messages = Messages_;
		this.OnChange = OnChange_;
		this.Map = Map_;
		this.session = session_;
	});
	messageGroup = $pkg.messageGroup = $newType(8, $kindInterface, "ninchatmodel.messageGroup", "messageGroup", "github.com/ninchat/ninchat-go/ninchatmodel", null);
	MessageWindow = $pkg.MessageWindow = $newType(0, $kindStruct, "ninchatmodel.MessageWindow", "MessageWindow", "github.com/ninchat/ninchat-go/ninchatmodel", function(Aux_, active_, missing_, missingSince_, ids_, minLoadedId_, maxLoadedId_, earliest_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Aux = new Aux.ptr(false);
			this.active = false;
			this.missing = false;
			this.missingSince = "";
			this.ids = sliceType.nil;
			this.minLoadedId = "";
			this.maxLoadedId = "";
			this.earliest = 0;
			return;
		}
		this.Aux = Aux_;
		this.active = active_;
		this.missing = missing_;
		this.missingSince = missingSince_;
		this.ids = ids_;
		this.minLoadedId = minLoadedId_;
		this.maxLoadedId = maxLoadedId_;
		this.earliest = earliest_;
	});
	MessageState = $pkg.MessageState = $newType(0, $kindStruct, "ninchatmodel.MessageState", "MessageState", "github.com/ninchat/ninchat-go/ninchatmodel", function(OnReceive_, OnUpdate_, session_, groupType_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.OnReceive = $throwNilPointerError;
			this.OnUpdate = $throwNilPointerError;
			this.session = ptrType$19.nil;
			this.groupType = "";
			return;
		}
		this.OnReceive = OnReceive_;
		this.OnUpdate = OnUpdate_;
		this.session = session_;
		this.groupType = groupType_;
	});
	SelfState = $pkg.SelfState = $newType(0, $kindStruct, "ninchatmodel.SelfState", "SelfState", "github.com/ninchat/ninchat-go/ninchatmodel", function(User_, OnChange_, session_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.User = new User.ptr(new Aux.ptr(false), "", ptrType$15.nil);
			this.OnChange = $throwNilPointerError;
			this.session = ptrType$19.nil;
			return;
		}
		this.User = User_;
		this.OnChange = OnChange_;
		this.session = session_;
	});
	SettingsState = $pkg.SettingsState = $newType(0, $kindStruct, "ninchatmodel.SettingsState", "SettingsState", "github.com/ninchat/ninchat-go/ninchatmodel", function(OnChange_, Data_, session_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.OnChange = $throwNilPointerError;
			this.Data = false;
			this.session = ptrType$19.nil;
			return;
		}
		this.OnChange = OnChange_;
		this.Data = Data_;
		this.session = session_;
	});
	State = $pkg.State = $newType(0, $kindStruct, "ninchatmodel.State", "State", "github.com/ninchat/ninchat-go/ninchatmodel", function(Session_, Self_, Settings_, Users_, Dialogues_, OnSessionEvent_, OnEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Session = new ninchat.Session.ptr($throwNilPointerError, $throwNilPointerError, $throwNilPointerError, $throwNilPointerError, $throwNilPointerError, $throwNilPointerError, "", false, false, $ifaceNil, "", new $Int64(0, 0), $chanNil, sliceType$3.nil, 0, false, new $Int64(0, 0), new $Int64(0, 0), $chanNil, false, false);
			this.Self = new SelfState.ptr(new User.ptr(new Aux.ptr(false), "", ptrType$15.nil), $throwNilPointerError, ptrType$19.nil);
			this.Settings = new SettingsState.ptr($throwNilPointerError, false, ptrType$19.nil);
			this.Users = new UserState.ptr($throwNilPointerError, false, ptrType$19.nil);
			this.Dialogues = new DialogueState.ptr(new MessageState.ptr($throwNilPointerError, $throwNilPointerError, ptrType$19.nil, ""), $throwNilPointerError, false, ptrType$19.nil);
			this.OnSessionEvent = $throwNilPointerError;
			this.OnEvent = $throwNilPointerError;
			return;
		}
		this.Session = Session_;
		this.Self = Self_;
		this.Settings = Settings_;
		this.Users = Users_;
		this.Dialogues = Dialogues_;
		this.OnSessionEvent = OnSessionEvent_;
		this.OnEvent = OnEvent_;
	});
	User = $pkg.User = $newType(0, $kindStruct, "ninchatmodel.User", "User", "github.com/ninchat/ninchat-go/ninchatmodel", function(Aux_, Id_, Attrs_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Aux = new Aux.ptr(false);
			this.Id = "";
			this.Attrs = ptrType$15.nil;
			return;
		}
		this.Aux = Aux_;
		this.Id = Id_;
		this.Attrs = Attrs_;
	});
	UserState = $pkg.UserState = $newType(0, $kindStruct, "ninchatmodel.UserState", "UserState", "github.com/ninchat/ninchat-go/ninchatmodel", function(OnChange_, Map_, session_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.OnChange = $throwNilPointerError;
			this.Map = false;
			this.session = ptrType$19.nil;
			return;
		}
		this.OnChange = OnChange_;
		this.Map = Map_;
		this.session = session_;
	});
	mapType = $mapType($String, $emptyInterface);
	ptrType = $ptrType($String);
	ptrType$1 = $ptrType($Int);
	sliceType = $sliceType($String);
	ptrType$2 = $ptrType(Dialogue);
	sliceType$1 = $sliceType($emptyInterface);
	sliceType$2 = $sliceType(ptrType$2);
	ptrType$3 = $ptrType(ninchatapi.UserDialogue);
	ptrType$4 = $ptrType(ninchatapi.DialogueMemberAttrs);
	ptrType$5 = $ptrType($Int32);
	ptrType$6 = $ptrType(ninchatapi.HistoryResults);
	ptrType$7 = $ptrType(ninchatapi.Error);
	ptrType$8 = $ptrType(ninchatapi.SessionCreated);
	ptrType$9 = $ptrType(ninchatapi.SessionStatusUpdated);
	ptrType$10 = $ptrType(ninchatapi.UserFound);
	ptrType$11 = $ptrType(ninchatapi.UserUpdated);
	ptrType$12 = $ptrType(ninchatapi.DialogueUpdated);
	ptrType$13 = $ptrType(ninchatapi.MessageReceived);
	ptrType$14 = $ptrType(ninchatapi.MessageUpdated);
	ptrType$15 = $ptrType(ninchatapi.UserAttrs);
	ptrType$16 = $ptrType(User);
	ptrType$17 = $ptrType(Aux);
	mapType$1 = $mapType($emptyInterface, $emptyInterface);
	ptrType$18 = $ptrType(ninchatapi.LoadHistory);
	ptrType$19 = $ptrType(ninchat.Session);
	mapType$2 = $mapType($String, ptrType$3);
	chanType = $chanType($error, false, true);
	ptrType$20 = $ptrType(DialogueState);
	funcType = $funcType([Change, ptrType$2], [], false);
	mapType$3 = $mapType($String, ptrType$2);
	ptrType$21 = $ptrType(MessageWindow);
	ptrType$22 = $ptrType(MessageState);
	funcType$1 = $funcType([$String, ptrType$13], [], false);
	funcType$2 = $funcType([$String, ptrType$14], [], false);
	ptrType$23 = $ptrType(SelfState);
	funcType$3 = $funcType([Change, ptrType$16, $String], [], false);
	ptrType$24 = $ptrType(SettingsState);
	funcType$4 = $funcType([Change, mapType], [], false);
	ptrType$25 = $ptrType(ninchat.Action);
	sliceType$3 = $sliceType(ptrType$25);
	ptrType$26 = $ptrType(ninchat.Event);
	ptrType$27 = $ptrType(State);
	funcType$5 = $funcType([ptrType$26], [], false);
	ptrType$28 = $ptrType(UserState);
	funcType$6 = $funcType([Change, ptrType$16], [], false);
	mapType$4 = $mapType($String, ptrType$16);
	Aux.ptr.prototype.GetAux = function(key) {
		var $ptr, _entry, aux, key;
		aux = this;
		return (_entry = aux.m[$emptyInterface.keyFor(key)], _entry !== undefined ? _entry.v : $ifaceNil);
	};
	Aux.prototype.GetAux = function(key) { return this.$val.GetAux(key); };
	Aux.ptr.prototype.SetAux = function(key, value) {
		var $ptr, _key, aux, key, value;
		aux = this;
		if (aux.m === false) {
			aux.m = {};
		}
		_key = key; (aux.m || $throwRuntimeError("assignment to entry in nil map"))[$emptyInterface.keyFor(_key)] = { k: _key, v: value };
	};
	Aux.prototype.SetAux = function(key, value) { return this.$val.SetAux(key, value); };
	Change.prototype.String = function() {
		var $ptr, _1, c;
		c = this.$val;
		_1 = c;
		if (_1 === 0) {
			return "unchanged";
		} else if (_1 === 1) {
			return "added";
		} else if (_1 === 2) {
			return "updated";
		} else if (_1 === 3) {
			return "removed";
		} else {
			return "invalid change value";
		}
	};
	$ptrType(Change).prototype.String = function() { return new Change(this.$get()).String(); };
	Dialogue.ptr.prototype.update = function(status, selfMemberAttrs, peerMemberAttrs, audienceMetadata) {
		var $ptr, _r, _r$1, _r$2, audienceMetadata, c, d, peerMemberAttrs, selfMemberAttrs, status, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; audienceMetadata = $f.audienceMetadata; c = $f.c; d = $f.d; peerMemberAttrs = $f.peerMemberAttrs; selfMemberAttrs = $f.selfMemberAttrs; status = $f.status; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		c = 0;
		d = this;
		if (!(d.Status === status)) {
			d.Status = status;
			c = 2;
		}
		_r = reflect.DeepEqual(d.SelfMemberAttrs, selfMemberAttrs); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ if (!_r) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!_r) { */ case 1:
			d.SelfMemberAttrs = selfMemberAttrs;
			c = 2;
		/* } */ case 2:
		_r$1 = reflect.DeepEqual(d.PeerMemberAttrs, peerMemberAttrs); /* */ $s = 6; case 6: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		/* */ if (!_r$1) { $s = 4; continue; }
		/* */ $s = 5; continue;
		/* if (!_r$1) { */ case 4:
			d.PeerMemberAttrs = peerMemberAttrs;
			c = 2;
		/* } */ case 5:
		_r$2 = reflect.DeepEqual(new mapType(d.AudienceMetadata), new mapType(audienceMetadata)); /* */ $s = 9; case 9: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		/* */ if (!_r$2) { $s = 7; continue; }
		/* */ $s = 8; continue;
		/* if (!_r$2) { */ case 7:
			d.AudienceMetadata = audienceMetadata;
			c = 2;
		/* } */ case 8:
		return c;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Dialogue.ptr.prototype.update }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f.audienceMetadata = audienceMetadata; $f.c = c; $f.d = d; $f.peerMemberAttrs = peerMemberAttrs; $f.selfMemberAttrs = selfMemberAttrs; $f.status = status; $f.$s = $s; $f.$r = $r; return $f;
	};
	Dialogue.prototype.update = function(status, selfMemberAttrs, peerMemberAttrs, audienceMetadata) { return this.$val.update(status, selfMemberAttrs, peerMemberAttrs, audienceMetadata); };
	Dialogue.ptr.prototype.updateStatus = function(status) {
		var $ptr, c, d, status;
		c = 0;
		d = this;
		if (!(d.Status === status)) {
			d.Status = status;
			c = 2;
		}
		return c;
	};
	Dialogue.prototype.updateStatus = function(status) { return this.$val.updateStatus(status); };
	Dialogue.ptr.prototype.updateStatusIfHigher = function(status) {
		var $ptr, c, d, status;
		c = 0;
		d = this;
		if (compareStatus(status, d.Status) > 0) {
			d.Status = status;
			c = 2;
		}
		return c;
	};
	Dialogue.prototype.updateStatusIfHigher = function(status) { return this.$val.updateStatusIfHigher(status); };
	Dialogue.ptr.prototype.updateStatusIfLower = function(status) {
		var $ptr, c, d, status;
		c = 0;
		d = this;
		if (compareStatus(status, d.Status) < 0) {
			d.Status = status;
			c = 2;
		}
		return c;
	};
	Dialogue.prototype.updateStatusIfLower = function(status) { return this.$val.updateStatusIfLower(status); };
	Dialogue.ptr.prototype.updateStatusIfRead = function(messageId) {
		var $ptr, c, d, messageId;
		c = 0;
		d = this;
		if (messageId >= d.Window.getLatestId()) {
			c = d.updateStatusIfLower("visible");
		}
		return c;
	};
	Dialogue.prototype.updateStatusIfRead = function(messageId) { return this.$val.updateStatusIfRead(messageId); };
	Dialogue.ptr.prototype.newLoadHistoryAction = function() {
		var $ptr, d;
		d = this;
		return new ninchatapi.LoadHistory.ptr(ptrType.nil, ptrType.nil, ptrType.nil, ptrType$1.nil, ptrType$1.nil, ptrType.nil, sliceType.nil, (d.$ptr_PeerId || (d.$ptr_PeerId = new ptrType(function() { return this.$target.PeerId; }, function($v) { this.$target.PeerId = $v; }, d))));
	};
	Dialogue.prototype.newLoadHistoryAction = function() { return this.$val.newLoadHistoryAction(); };
	DialogueState.ptr.prototype.init = function(session) {
		var $ptr, session, state;
		state = this;
		state.session = session;
		state.Messages.init(session, "dialogue");
		state.Map = {};
	};
	DialogueState.prototype.init = function(session) { return this.$val.init(session); };
	DialogueState.ptr.prototype.handleSessionStatus = function(e) {
		var $ptr, _entry, c, d, e, state, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _entry = $f._entry; c = $f.c; d = $f.d; e = $f.e; state = $f.state; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		state = this;
		d = (_entry = state.Map[$String.keyFor(e.UserId.$get())], _entry !== undefined ? _entry.v : ptrType$2.nil);
		/* */ if (!(d === ptrType$2.nil)) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!(d === ptrType$2.nil)) { */ case 1:
			c = d.updateStatusIfRead(e.MessageId);
			$r = state.log(new sliceType$1([new $String(d.PeerId), new $String(new Change(c).String()), new $String("with status"), new $String(d.Status), new $String("by"), new $String(e.String())])); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* */ if (!((c === 0))) { $s = 5; continue; }
			/* */ $s = 6; continue;
			/* if (!((c === 0))) { */ case 5:
				$r = state.OnChange(c, d); /* */ $s = 7; case 7: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* } */ case 6:
			$s = 3; continue;
		/* } else { */ case 2:
			$r = state.log(new sliceType$1([new $String(d.PeerId), new $String("referenced by"), new $String(e.String()), new $String("is unknown")])); /* */ $s = 8; case 8: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 3:
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: DialogueState.ptr.prototype.handleSessionStatus }; } $f.$ptr = $ptr; $f._entry = _entry; $f.c = c; $f.d = d; $f.e = e; $f.state = state; $f.$s = $s; $f.$r = $r; return $f;
	};
	DialogueState.prototype.handleSessionStatus = function(e) { return this.$val.handleSessionStatus(e); };
	DialogueState.ptr.prototype.handleUser = function(selfId, userDialogues, eventName) {
		var $ptr, _entry, _entry$1, _entry$2, _entry$3, _entry$4, _entry$5, _entry$6, _entry$7, _i, _i$1, _i$2, _key, _keys, _keys$1, _r, _ref, _ref$1, _ref$2, c, d, d$1, d$2, discard, eventName, peerId, peerId$1, selfId, state, ud, userDialogues, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _entry = $f._entry; _entry$1 = $f._entry$1; _entry$2 = $f._entry$2; _entry$3 = $f._entry$3; _entry$4 = $f._entry$4; _entry$5 = $f._entry$5; _entry$6 = $f._entry$6; _entry$7 = $f._entry$7; _i = $f._i; _i$1 = $f._i$1; _i$2 = $f._i$2; _key = $f._key; _keys = $f._keys; _keys$1 = $f._keys$1; _r = $f._r; _ref = $f._ref; _ref$1 = $f._ref$1; _ref$2 = $f._ref$2; c = $f.c; d = $f.d; d$1 = $f.d$1; d$2 = $f.d$2; discard = $f.discard; eventName = $f.eventName; peerId = $f.peerId; peerId$1 = $f.peerId$1; selfId = $f.selfId; state = $f.state; ud = $f.ud; userDialogues = $f.userDialogues; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		state = this;
		discard = sliceType$2.nil;
		_ref = state.Map;
		_i = 0;
		_keys = $keys(_ref);
		while (true) {
			if (!(_i < _keys.length)) { break; }
			_entry = _ref[_keys[_i]];
			if (_entry === undefined) {
				_i++;
				continue;
			}
			peerId = _entry.k;
			d = _entry.v;
			if ((_entry$1 = userDialogues[$String.keyFor(peerId)], _entry$1 !== undefined ? _entry$1.v : ptrType$3.nil) === ptrType$3.nil) {
				discard = $append(discard, d);
			}
			_i++;
		}
		_ref$1 = discard;
		_i$1 = 0;
		/* while (true) { */ case 1:
			/* if (!(_i$1 < _ref$1.$length)) { break; } */ if(!(_i$1 < _ref$1.$length)) { $s = 2; continue; }
			d$1 = ((_i$1 < 0 || _i$1 >= _ref$1.$length) ? $throwRuntimeError("index out of range") : _ref$1.$array[_ref$1.$offset + _i$1]);
			delete state.Map[$String.keyFor(d$1.PeerId)];
			$r = state.log(new sliceType$1([new $String(d$1.PeerId), new $String("removed by"), new $String(eventName)])); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			$r = state.OnChange(3, d$1); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			_i$1++;
		/* } */ $s = 1; continue; case 2:
		_ref$2 = userDialogues;
		_i$2 = 0;
		_keys$1 = $keys(_ref$2);
		/* while (true) { */ case 5:
			/* if (!(_i$2 < _keys$1.length)) { break; } */ if(!(_i$2 < _keys$1.length)) { $s = 6; continue; }
			_entry$2 = _ref$2[_keys$1[_i$2]];
			if (_entry$2 === undefined) {
				_i$2++;
				/* continue; */ $s = 5; continue;
			}
			peerId$1 = _entry$2.k;
			ud = _entry$2.v;
			c = 0;
			d$2 = (_entry$3 = state.Map[$String.keyFor(peerId$1)], _entry$3 !== undefined ? _entry$3.v : ptrType$2.nil);
			/* */ if (!(d$2 === ptrType$2.nil)) { $s = 7; continue; }
			/* */ $s = 8; continue;
			/* if (!(d$2 === ptrType$2.nil)) { */ case 7:
				_r = d$2.update(ud.DialogueStatus.$get(), (_entry$4 = ud.DialogueMembers[$String.keyFor(selfId)], _entry$4 !== undefined ? _entry$4.v : ptrType$4.nil), (_entry$5 = ud.DialogueMembers[$String.keyFor(peerId$1)], _entry$5 !== undefined ? _entry$5.v : ptrType$4.nil), ud.AudienceMetadata); /* */ $s = 10; case 10: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				c = _r;
				$s = 9; continue;
			/* } else { */ case 8:
				d$2 = new Dialogue.ptr(peerId$1, ud.DialogueStatus.$get(), (_entry$6 = ud.DialogueMembers[$String.keyFor(selfId)], _entry$6 !== undefined ? _entry$6.v : ptrType$4.nil), (_entry$7 = ud.DialogueMembers[$String.keyFor(peerId$1)], _entry$7 !== undefined ? _entry$7.v : ptrType$4.nil), ud.AudienceMetadata, new MessageWindow.ptr(new Aux.ptr(false), false, false, "", sliceType.nil, "", "", 0));
				_key = peerId$1; (state.Map || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key)] = { k: _key, v: d$2 };
				c = 1;
			/* } */ case 9:
			$r = state.log(new sliceType$1([new $String(peerId$1), new $String(new Change(c).String()), new $String("with status"), new $String(d$2.Status), new $String("by"), new $String(eventName)])); /* */ $s = 11; case 11: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* */ if (!((c === 0))) { $s = 12; continue; }
			/* */ $s = 13; continue;
			/* if (!((c === 0))) { */ case 12:
				$r = state.OnChange(c, d$2); /* */ $s = 14; case 14: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* } */ case 13:
			_i$2++;
		/* } */ $s = 5; continue; case 6:
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: DialogueState.ptr.prototype.handleUser }; } $f.$ptr = $ptr; $f._entry = _entry; $f._entry$1 = _entry$1; $f._entry$2 = _entry$2; $f._entry$3 = _entry$3; $f._entry$4 = _entry$4; $f._entry$5 = _entry$5; $f._entry$6 = _entry$6; $f._entry$7 = _entry$7; $f._i = _i; $f._i$1 = _i$1; $f._i$2 = _i$2; $f._key = _key; $f._keys = _keys; $f._keys$1 = _keys$1; $f._r = _r; $f._ref = _ref; $f._ref$1 = _ref$1; $f._ref$2 = _ref$2; $f.c = c; $f.d = d; $f.d$1 = d$1; $f.d$2 = d$2; $f.discard = discard; $f.eventName = eventName; $f.peerId = peerId; $f.peerId$1 = peerId$1; $f.selfId = selfId; $f.state = state; $f.ud = ud; $f.userDialogues = userDialogues; $f.$s = $s; $f.$r = $r; return $f;
	};
	DialogueState.prototype.handleUser = function(selfId, userDialogues, eventName) { return this.$val.handleUser(selfId, userDialogues, eventName); };
	DialogueState.ptr.prototype.handleDialogue = function(selfId, e) {
		var $ptr, _entry, _entry$1, _entry$2, _entry$3, _entry$4, _key, _r, c, d, e, selfId, state, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _entry = $f._entry; _entry$1 = $f._entry$1; _entry$2 = $f._entry$2; _entry$3 = $f._entry$3; _entry$4 = $f._entry$4; _key = $f._key; _r = $f._r; c = $f.c; d = $f.d; e = $f.e; selfId = $f.selfId; state = $f.state; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		state = this;
		d = (_entry = state.Map[$String.keyFor(e.UserId)], _entry !== undefined ? _entry.v : ptrType$2.nil);
		/* */ if (!(e.DialogueStatus === ptrType.nil)) { $s = 1; continue; }
		/* */ if (!(d === ptrType$2.nil)) { $s = 2; continue; }
		/* */ $s = 3; continue;
		/* if (!(e.DialogueStatus === ptrType.nil)) { */ case 1:
			c = 0;
			/* */ if (!(d === ptrType$2.nil)) { $s = 4; continue; }
			/* */ $s = 5; continue;
			/* if (!(d === ptrType$2.nil)) { */ case 4:
				_r = d.update(e.DialogueStatus.$get(), (_entry$1 = e.DialogueMembers[$String.keyFor(selfId)], _entry$1 !== undefined ? _entry$1.v : ptrType$4.nil), (_entry$2 = e.DialogueMembers[$String.keyFor(e.UserId)], _entry$2 !== undefined ? _entry$2.v : ptrType$4.nil), e.AudienceMetadata); /* */ $s = 7; case 7: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				c = _r;
				$s = 6; continue;
			/* } else { */ case 5:
				d = new Dialogue.ptr(e.UserId, e.DialogueStatus.$get(), (_entry$3 = e.DialogueMembers[$String.keyFor(selfId)], _entry$3 !== undefined ? _entry$3.v : ptrType$4.nil), (_entry$4 = e.DialogueMembers[$String.keyFor(e.UserId)], _entry$4 !== undefined ? _entry$4.v : ptrType$4.nil), e.AudienceMetadata, new MessageWindow.ptr(new Aux.ptr(false), false, false, "", sliceType.nil, "", "", 0));
				_key = e.UserId; (state.Map || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key)] = { k: _key, v: d };
				c = 1;
			/* } */ case 6:
			$r = state.log(new sliceType$1([new $String(e.UserId), new $String(new Change(c).String()), new $String("with status"), new $String(d.Status), new $String("by"), new $String(e.String())])); /* */ $s = 8; case 8: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* */ if (!((c === 0))) { $s = 9; continue; }
			/* */ $s = 10; continue;
			/* if (!((c === 0))) { */ case 9:
				$r = state.OnChange(c, d); /* */ $s = 11; case 11: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* } */ case 10:
			$s = 3; continue;
		/* } else if (!(d === ptrType$2.nil)) { */ case 2:
			delete state.Map[$String.keyFor(e.UserId)];
			$r = state.log(new sliceType$1([new $String(e.UserId), new $String("removed by"), new $String(e.String())])); /* */ $s = 12; case 12: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			$r = state.OnChange(3, d); /* */ $s = 13; case 13: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 3:
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: DialogueState.ptr.prototype.handleDialogue }; } $f.$ptr = $ptr; $f._entry = _entry; $f._entry$1 = _entry$1; $f._entry$2 = _entry$2; $f._entry$3 = _entry$3; $f._entry$4 = _entry$4; $f._key = _key; $f._r = _r; $f.c = c; $f.d = d; $f.e = e; $f.selfId = selfId; $f.state = state; $f.$s = $s; $f.$r = $r; return $f;
	};
	DialogueState.prototype.handleDialogue = function(selfId, e) { return this.$val.handleDialogue(selfId, e); };
	DialogueState.ptr.prototype.handleReceive = function(selfId, e) {
		var $ptr, _entry, _key, c, d, e, selfId, state, status, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _entry = $f._entry; _key = $f._key; c = $f.c; d = $f.d; e = $f.e; selfId = $f.selfId; state = $f.state; status = $f.status; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		state = this;
		status = "highlight";
		if (!(e.MessageUserId === ptrType.nil) && e.MessageUserId.$get() === selfId) {
			status = "visible";
		}
		c = 0;
		d = (_entry = state.Map[$String.keyFor(e.UserId.$get())], _entry !== undefined ? _entry.v : ptrType$2.nil);
		if (!(d === ptrType$2.nil)) {
			c = d.updateStatusIfHigher(status);
		} else {
			d = new Dialogue.ptr(e.UserId.$get(), status, new ninchatapi.DialogueMemberAttrs.ptr(false, ptrType.nil, ptrType$1.nil, false), new ninchatapi.DialogueMemberAttrs.ptr(false, ptrType.nil, ptrType$1.nil, false), false, new MessageWindow.ptr(new Aux.ptr(false), false, false, "", sliceType.nil, "", "", 0));
			_key = e.UserId.$get(); (state.Map || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key)] = { k: _key, v: d };
			c = 1;
		}
		$r = state.log(new sliceType$1([new $String(d.PeerId), new $String(new Change(c).String()), new $String("with status"), new $String(d.Status), new $String("by"), new $String(e.String())])); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* */ if (!((c === 0))) { $s = 2; continue; }
		/* */ $s = 3; continue;
		/* if (!((c === 0))) { */ case 2:
			$r = state.OnChange(c, d); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 3:
		$r = state.Messages.handleReceive(e.UserId.$get(), d.Window, e); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: DialogueState.ptr.prototype.handleReceive }; } $f.$ptr = $ptr; $f._entry = _entry; $f._key = _key; $f.c = c; $f.d = d; $f.e = e; $f.selfId = selfId; $f.state = state; $f.status = status; $f.$s = $s; $f.$r = $r; return $f;
	};
	DialogueState.prototype.handleReceive = function(selfId, e) { return this.$val.handleReceive(selfId, e); };
	DialogueState.ptr.prototype.LoadEarlier = function(peerId) {
		var $ptr, _entry, _key, _r, c, d, peerId, state, status, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _entry = $f._entry; _key = $f._key; _r = $f._r; c = $f.c; d = $f.d; peerId = $f.peerId; state = $f.state; status = $f.status; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		peerId = [peerId];
		status = [status];
		state = this;
		status[0] = "visible";
		c = 0;
		d = (_entry = state.Map[$String.keyFor(peerId[0])], _entry !== undefined ? _entry.v : ptrType$2.nil);
		if (!(d === ptrType$2.nil)) {
			c = d.updateStatusIfHigher(status[0]);
		} else {
			d = new Dialogue.ptr(peerId[0], status[0], new ninchatapi.DialogueMemberAttrs.ptr(false, ptrType.nil, ptrType$1.nil, false), new ninchatapi.DialogueMemberAttrs.ptr(false, ptrType.nil, ptrType$1.nil, false), false, new MessageWindow.ptr(new Aux.ptr(false), false, false, "", sliceType.nil, "", "", 0));
			_key = peerId[0]; (state.Map || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key)] = { k: _key, v: d };
			c = 1;
		}
		$r = state.log(new sliceType$1([new $String(peerId[0]), new $String("status"), new $String(new Change(c).String()), new $String("with value"), new $String(status[0])])); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* */ if (!((c === 0))) { $s = 2; continue; }
		/* */ $s = 3; continue;
		/* if (!((c === 0))) { */ case 2:
			_r = ninchatapi.Send(state.session, new ninchatapi.UpdateDialogue.ptr((status.$ptr || (status.$ptr = new ptrType(function() { return this.$target[0]; }, function($v) { this.$target[0] = $v; }, status))), ptrType$4.nil, (peerId.$ptr || (peerId.$ptr = new ptrType(function() { return this.$target[0]; }, function($v) { this.$target[0] = $v; }, peerId))))); /* */ $s = 4; case 4: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			_r;
			$r = state.OnChange(c, d); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 3:
		return d.Window.loadEarlier(state.session, new ninchatapi.LoadHistory.ptr(ptrType.nil, ptrType.nil, ptrType.nil, ptrType$1.nil, ptrType$1.nil, ptrType.nil, sliceType.nil, (peerId.$ptr || (peerId.$ptr = new ptrType(function() { return this.$target[0]; }, function($v) { this.$target[0] = $v; }, peerId)))));
		/* */ } return; } if ($f === undefined) { $f = { $blk: DialogueState.ptr.prototype.LoadEarlier }; } $f.$ptr = $ptr; $f._entry = _entry; $f._key = _key; $f._r = _r; $f.c = c; $f.d = d; $f.peerId = peerId; $f.state = state; $f.status = status; $f.$s = $s; $f.$r = $r; return $f;
	};
	DialogueState.prototype.LoadEarlier = function(peerId) { return this.$val.LoadEarlier(peerId); };
	DialogueState.ptr.prototype.UpdateStatus = function(d, status) {
		var $ptr, _r, c, d, state, status, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; c = $f.c; d = $f.d; state = $f.state; status = $f.status; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		status = [status];
		state = this;
		c = d.updateStatus(status[0]);
		$r = state.log(new sliceType$1([new $String(d.PeerId), new $String("status"), new $String(new Change(c).String()), new $String("with value"), new $String(status[0])])); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* */ if (!((c === 0))) { $s = 2; continue; }
		/* */ $s = 3; continue;
		/* if (!((c === 0))) { */ case 2:
			_r = ninchatapi.Send(state.session, new ninchatapi.UpdateDialogue.ptr((status.$ptr || (status.$ptr = new ptrType(function() { return this.$target[0]; }, function($v) { this.$target[0] = $v; }, status))), ptrType$4.nil, (d.$ptr_PeerId || (d.$ptr_PeerId = new ptrType(function() { return this.$target.PeerId; }, function($v) { this.$target.PeerId = $v; }, d))))); /* */ $s = 4; case 4: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			_r;
			$r = state.OnChange(c, d); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 3:
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: DialogueState.ptr.prototype.UpdateStatus }; } $f.$ptr = $ptr; $f._r = _r; $f.c = c; $f.d = d; $f.state = state; $f.status = status; $f.$s = $s; $f.$r = $r; return $f;
	};
	DialogueState.prototype.UpdateStatus = function(d, status) { return this.$val.UpdateStatus(d, status); };
	DialogueState.ptr.prototype.Activate = function(d) {
		var $ptr, d, state, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; d = $f.d; state = $f.state; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		state = this;
		$r = d.Window.activate(state.session, d); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: DialogueState.ptr.prototype.Activate }; } $f.$ptr = $ptr; $f.d = d; $f.state = state; $f.$s = $s; $f.$r = $r; return $f;
	};
	DialogueState.prototype.Activate = function(d) { return this.$val.Activate(d); };
	DialogueState.ptr.prototype.Discard = function(d) {
		var $ptr, _r, d, messageId, state, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; d = $f.d; messageId = $f.messageId; state = $f.state; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		messageId = [messageId];
		state = this;
		delete state.Map[$String.keyFor(d.PeerId)];
		messageId[0] = d.Window.getLatestId();
		/* */ if (!(messageId[0] === "")) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!(messageId[0] === "")) { */ case 1:
			_r = ninchatapi.Send(state.session, new ninchatapi.DiscardHistory.ptr((messageId.$ptr || (messageId.$ptr = new ptrType(function() { return this.$target[0]; }, function($v) { this.$target[0] = $v; }, messageId))), (d.$ptr_PeerId || (d.$ptr_PeerId = new ptrType(function() { return this.$target.PeerId; }, function($v) { this.$target.PeerId = $v; }, d))))); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			_r;
		/* } */ case 2:
		$r = state.log(new sliceType$1([new $String(d.PeerId), new $String("removed")])); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = state.OnChange(3, d); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: DialogueState.ptr.prototype.Discard }; } $f.$ptr = $ptr; $f._r = _r; $f.d = d; $f.messageId = messageId; $f.state = state; $f.$s = $s; $f.$r = $r; return $f;
	};
	DialogueState.prototype.Discard = function(d) { return this.$val.Discard(d); };
	DialogueState.ptr.prototype.log = function(fragments) {
		var $ptr, fragments, state, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; fragments = $f.fragments; state = $f.state; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		state = this;
		$r = log(state.session, "dialogue:", fragments); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: DialogueState.ptr.prototype.log }; } $f.$ptr = $ptr; $f.fragments = fragments; $f.state = state; $f.$s = $s; $f.$r = $r; return $f;
	};
	DialogueState.prototype.log = function(fragments) { return this.$val.log(fragments); };
	MessageWindow.ptr.prototype.GetAux = function(key) {
		var $ptr, key, w;
		w = this;
		return w.Aux.GetAux(key);
	};
	MessageWindow.prototype.GetAux = function(key) { return this.$val.GetAux(key); };
	MessageWindow.ptr.prototype.SetAux = function(key, value) {
		var $ptr, key, value, w;
		w = this;
		w.Aux.SetAux(key, value);
	};
	MessageWindow.prototype.SetAux = function(key, value) { return this.$val.SetAux(key, value); };
	MessageWindow.ptr.prototype.IsActive = function() {
		var $ptr, w;
		w = this;
		return w.active;
	};
	MessageWindow.prototype.IsActive = function() { return this.$val.IsActive(); };
	MessageWindow.ptr.prototype.activate = function(session, group) {
		var $ptr, group, session, w, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; group = $f.group; session = $f.session; w = $f.w; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		w = this;
		/* */ if (!w.active) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!w.active) { */ case 1:
			w.active = true;
			/* */ if (w.missing) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (w.missing) { */ case 3:
				$r = w.loadMissing(session, group); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* } */ case 4:
		/* } */ case 2:
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: MessageWindow.ptr.prototype.activate }; } $f.$ptr = $ptr; $f.group = group; $f.session = session; $f.w = w; $f.$s = $s; $f.$r = $r; return $f;
	};
	MessageWindow.prototype.activate = function(session, group) { return this.$val.activate(session, group); };
	MessageWindow.ptr.prototype.Deactivate = function() {
		var $ptr, w;
		w = this;
		w.active = false;
	};
	MessageWindow.prototype.Deactivate = function() { return this.$val.Deactivate(); };
	MessageWindow.ptr.prototype.GetLength = function() {
		var $ptr, w;
		w = this;
		return w.ids.$length;
	};
	MessageWindow.prototype.GetLength = function() { return this.$val.GetLength(); };
	MessageWindow.ptr.prototype.HasEarliest = function() {
		var $ptr, w;
		w = this;
		return !((atomic.LoadInt32((w.$ptr_earliest || (w.$ptr_earliest = new ptrType$5(function() { return this.$target.earliest; }, function($v) { this.$target.earliest = $v; }, w)))) === 0));
	};
	MessageWindow.prototype.HasEarliest = function() { return this.$val.HasEarliest(); };
	MessageWindow.ptr.prototype.gotEarliest = function() {
		var $ptr, w;
		w = this;
		atomic.StoreInt32((w.$ptr_earliest || (w.$ptr_earliest = new ptrType$5(function() { return this.$target.earliest; }, function($v) { this.$target.earliest = $v; }, w))), 1);
	};
	MessageWindow.prototype.gotEarliest = function() { return this.$val.gotEarliest(); };
	MessageWindow.ptr.prototype.getLatestId = function() {
		var $ptr, id, w, x, x$1;
		id = "";
		w = this;
		if (w.ids.$length > 0) {
			id = (x = w.ids, x$1 = w.ids.$length - 1 >> 0, ((x$1 < 0 || x$1 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + x$1]));
		}
		return id;
	};
	MessageWindow.prototype.getLatestId = function() { return this.$val.getLatestId(); };
	MessageWindow.ptr.prototype.indexOf = function(id) {
		var $ptr, _r, found, i, id, w, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; found = $f.found; i = $f.i; id = $f.id; w = $f.w; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		i = 0;
		found = false;
		w = this;
		_r = sort.SearchStrings(w.ids, id); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		i = _r;
		found = i < w.ids.$length && (x = w.ids, ((i < 0 || i >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + i])) === id;
		return [i, found];
		/* */ } return; } if ($f === undefined) { $f = { $blk: MessageWindow.ptr.prototype.indexOf }; } $f.$ptr = $ptr; $f._r = _r; $f.found = found; $f.i = i; $f.id = id; $f.w = w; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	MessageWindow.prototype.indexOf = function(id) { return this.$val.indexOf(id); };
	MessageWindow.ptr.prototype.handleSecondarySession = function(session, group) {
		var $ptr, group, id, session, w, x, x$1, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; group = $f.group; id = $f.id; session = $f.session; w = $f.w; x = $f.x; x$1 = $f.x$1; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		w = this;
		if (!w.missing) {
			w.missing = true;
			w.missingSince = w.maxLoadedId;
			if (w.ids.$length >= 10) {
				id = (x = w.ids, x$1 = w.ids.$length - 10 >> 0, ((x$1 < 0 || x$1 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + x$1]));
				if (strings.Compare(id, w.missingSince) > 0) {
					w.missingSince = id;
				}
			}
		}
		/* */ if (w.active) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (w.active) { */ case 1:
			$r = w.loadMissing(session, group); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 2:
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: MessageWindow.ptr.prototype.handleSecondarySession }; } $f.$ptr = $ptr; $f.group = group; $f.id = id; $f.session = session; $f.w = w; $f.x = x; $f.x$1 = x$1; $f.$s = $s; $f.$r = $r; return $f;
	};
	MessageWindow.prototype.handleSecondarySession = function(session, group) { return this.$val.handleSecondarySession(session, group); };
	MessageWindow.ptr.prototype.prepareReceive = function(e) {
		var $ptr, _r, _tuple, e, found, i, ok, w, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tuple = $f._tuple; e = $f.e; found = $f.found; i = $f.i; ok = $f.ok; w = $f.w; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		ok = false;
		w = this;
		if (!(e.HistoryLength === ptrType$1.nil)) {
			if (w.minLoadedId === "" || strings.Compare(e.MessageId, w.minLoadedId) < 0) {
				w.minLoadedId = e.MessageId;
			}
			if (strings.Compare(e.MessageId, w.maxLoadedId) > 0) {
				w.maxLoadedId = e.MessageId;
			}
		}
		_r = w.indexOf(e.MessageId); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		i = _tuple[0];
		found = _tuple[1];
		if (!found) {
			w.ids = $appendSlice($subslice(w.ids, 0, i), $appendSlice(new sliceType([e.MessageId]), $subslice(w.ids, i)));
			ok = true;
		}
		return ok;
		/* */ } return; } if ($f === undefined) { $f = { $blk: MessageWindow.ptr.prototype.prepareReceive }; } $f.$ptr = $ptr; $f._r = _r; $f._tuple = _tuple; $f.e = e; $f.found = found; $f.i = i; $f.ok = ok; $f.w = w; $f.$s = $s; $f.$r = $r; return $f;
	};
	MessageWindow.prototype.prepareReceive = function(e) { return this.$val.prepareReceive(e); };
	MessageWindow.ptr.prototype.loadEarlier = function(session, action) {
		var $ptr, action, id, id$24ptr, loaded, session, w;
		w = this;
		loaded = new $Chan($error, 1);
		if (w.HasEarliest()) {
			$close(loaded);
		} else {
			if (!(w.minLoadedId === "")) {
				id = w.minLoadedId;
				action.MessageId = (id$24ptr || (id$24ptr = new ptrType(function() { return id; }, function($v) { id = $v; })));
			}
			$go((function $b() {
				var $ptr, _r, _tuple, e, err, $s, $deferred, $r;
				/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tuple = $f._tuple; e = $f.e; err = $f.err; $s = $f.$s; $deferred = $f.$deferred; $r = $f.$r; } var $err = null; try { s: while (true) { switch ($s) { case 0: $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
				err = [err];
				err[0] = $ifaceNil;
				$deferred.push([(function(err) { return function $b() {
					var $ptr, $s, $r;
					/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
					/* */ if (!($interfaceIsEqual(err[0], $ifaceNil))) { $s = 1; continue; }
					/* */ $s = 2; continue;
					/* if (!($interfaceIsEqual(err[0], $ifaceNil))) { */ case 1:
						$r = $send(loaded, err[0]); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					/* } */ case 2:
					$close(loaded);
					/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f.$s = $s; $f.$r = $r; return $f;
				}; })(err), []]);
				_r = action.Invoke(session); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				_tuple = _r;
				e = _tuple[0];
				err[0] = _tuple[1];
				if (!($interfaceIsEqual(err[0], $ifaceNil))) {
					$panic(err[0]);
				}
				if (e === ptrType$6.nil) {
					return;
				}
				if (e.HistoryLength === 0) {
					w.gotEarliest();
				}
				/* */ $s = -1; case -1: } return; } } catch(err) { $err = err; $s = -1; } finally { $callDeferred($deferred, $err); if($curGoroutine.asleep) { if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f._r = _r; $f._tuple = _tuple; $f.e = e; $f.err = err; $f.$s = $s; $f.$deferred = $deferred; $f.$r = $r; return $f; } }
			}), []);
		}
		return loaded;
	};
	MessageWindow.prototype.loadEarlier = function(session, action) { return this.$val.loadEarlier(session, action); };
	MessageWindow.ptr.prototype.loadMissing = function(session, group) {
		var $ptr, _arg, _arg$1, _r, _r$1, group, messageId, session, w, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _arg = $f._arg; _arg$1 = $f._arg$1; _r = $f._r; _r$1 = $f._r$1; group = $f.group; messageId = $f.messageId; session = $f.session; w = $f.w; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		group = [group];
		messageId = [messageId];
		session = [session];
		w = this;
		/* */ if (w.missingSince === "") { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (w.missingSince === "") { */ case 1:
			_arg = session[0];
			_r = group[0].newLoadHistoryAction(); /* */ $s = 4; case 4: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			_arg$1 = _r;
			_r$1 = w.loadEarlier(_arg, _arg$1); /* */ $s = 5; case 5: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			_r$1;
			$s = 3; continue;
		/* } else { */ case 2:
			messageId[0] = w.missingSince;
			$go((function(group, messageId, session) { return function $b() {
				var $ptr, _r$2, _r$3, _tuple, action, e, err, length, order, $s, $r;
				/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$2 = $f._r$2; _r$3 = $f._r$3; _tuple = $f._tuple; action = $f.action; e = $f.e; err = $f.err; length = $f.length; order = $f.order; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
				length = [length];
				order = [order];
				order[0] = 1;
				length[0] = 1000;
				/* while (true) { */ case 1:
					_r$2 = group[0].newLoadHistoryAction(); /* */ $s = 3; case 3: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
					action = _r$2;
					action.MessageId = (messageId.$ptr || (messageId.$ptr = new ptrType(function() { return this.$target[0]; }, function($v) { this.$target[0] = $v; }, messageId)));
					action.HistoryOrder = (order.$ptr || (order.$ptr = new ptrType$1(function() { return this.$target[0]; }, function($v) { this.$target[0] = $v; }, order)));
					action.HistoryLength = (length.$ptr || (length.$ptr = new ptrType$1(function() { return this.$target[0]; }, function($v) { this.$target[0] = $v; }, length)));
					_r$3 = action.Invoke(session[0]); /* */ $s = 4; case 4: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
					_tuple = _r$3;
					e = _tuple[0];
					err = _tuple[1];
					if (!($interfaceIsEqual(err, $ifaceNil))) {
						return;
					}
					if (e === ptrType$6.nil) {
						return;
					}
					if (e.HistoryLength === 0) {
						/* break; */ $s = 2; continue;
					}
					messageId[0] = e.MessageId.$get();
				/* } */ $s = 1; continue; case 2:
				/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._tuple = _tuple; $f.action = action; $f.e = e; $f.err = err; $f.length = length; $f.order = order; $f.$s = $s; $f.$r = $r; return $f;
			}; })(group, messageId, session), []);
		/* } */ case 3:
		w.missing = false;
		w.missingSince = "";
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: MessageWindow.ptr.prototype.loadMissing }; } $f.$ptr = $ptr; $f._arg = _arg; $f._arg$1 = _arg$1; $f._r = _r; $f._r$1 = _r$1; $f.group = group; $f.messageId = messageId; $f.session = session; $f.w = w; $f.$s = $s; $f.$r = $r; return $f;
	};
	MessageWindow.prototype.loadMissing = function(session, group) { return this.$val.loadMissing(session, group); };
	MessageState.ptr.prototype.init = function(session, groupType) {
		var $ptr, groupType, session, state;
		state = this;
		state.session = session;
		state.groupType = groupType;
	};
	MessageState.prototype.init = function(session, groupType) { return this.$val.init(session, groupType); };
	MessageState.ptr.prototype.handleReceive = function(groupId, w, e) {
		var $ptr, _r, e, groupId, state, w, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; e = $f.e; groupId = $f.groupId; state = $f.state; w = $f.w; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		state = this;
		_r = w.prepareReceive(e); /* */ $s = 4; case 4: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ if (_r) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (_r) { */ case 1:
			$r = state.log(groupId, new sliceType$1([new $String(e.MessageId), new $String("received")])); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			$r = state.OnReceive(groupId, e); /* */ $s = 6; case 6: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			$s = 3; continue;
		/* } else { */ case 2:
			$r = state.log(groupId, new sliceType$1([new $String(e.MessageId), new $String("received again")])); /* */ $s = 7; case 7: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 3:
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: MessageState.ptr.prototype.handleReceive }; } $f.$ptr = $ptr; $f._r = _r; $f.e = e; $f.groupId = groupId; $f.state = state; $f.w = w; $f.$s = $s; $f.$r = $r; return $f;
	};
	MessageState.prototype.handleReceive = function(groupId, w, e) { return this.$val.handleReceive(groupId, w, e); };
	MessageState.ptr.prototype.log = function(groupId, fragments) {
		var $ptr, fragments, groupId, state, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; fragments = $f.fragments; groupId = $f.groupId; state = $f.state; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		state = this;
		/* */ if (!(state.session.OnLog === $throwNilPointerError)) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!(state.session.OnLog === $throwNilPointerError)) { */ case 1:
			fragments = $appendSlice(new sliceType$1([new $String(state.groupType), new $String(groupId), new $String("message:")]), fragments);
			$r = state.session.OnLog(fragments); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 2:
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: MessageState.ptr.prototype.log }; } $f.$ptr = $ptr; $f.fragments = fragments; $f.groupId = groupId; $f.state = state; $f.$s = $s; $f.$r = $r; return $f;
	};
	MessageState.prototype.log = function(groupId, fragments) { return this.$val.log(groupId, fragments); };
	SelfState.ptr.prototype.init = function(session) {
		var $ptr, session, state;
		state = this;
		state.session = session;
	};
	SelfState.prototype.init = function(session) { return this.$val.init(session); };
	SelfState.ptr.prototype.handleSession = function(e) {
		var $ptr, _r, auth, c, e, state, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; auth = $f.auth; c = $f.c; e = $f.e; state = $f.state; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		state = this;
		c = 0;
		auth = "";
		/* */ if (!(state.User.Id === "")) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!(state.User.Id === "")) { */ case 1:
			_r = state.User.update(e.UserAttrs); /* */ $s = 4; case 4: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			c = _r;
			$s = 3; continue;
		/* } else { */ case 2:
			state.User.Id = e.UserId;
			state.User.Attrs = e.UserAttrs;
			if (!(e.UserAuth === ptrType.nil)) {
				auth = e.UserAuth.$get();
			}
			c = 1;
		/* } */ case 3:
		$r = state.log(new sliceType$1([new $String(state.User.Id), new $String(new Change(c).String()), new $String("by"), new $String(e.String())])); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* */ if (!((c === 0))) { $s = 6; continue; }
		/* */ $s = 7; continue;
		/* if (!((c === 0))) { */ case 6:
			$r = state.OnChange(c, state.User, auth); /* */ $s = 8; case 8: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 7:
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: SelfState.ptr.prototype.handleSession }; } $f.$ptr = $ptr; $f._r = _r; $f.auth = auth; $f.c = c; $f.e = e; $f.state = state; $f.$s = $s; $f.$r = $r; return $f;
	};
	SelfState.prototype.handleSession = function(e) { return this.$val.handleSession(e); };
	SelfState.ptr.prototype.handleUser = function(attrs, eventName) {
		var $ptr, _r, attrs, c, eventName, state, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; attrs = $f.attrs; c = $f.c; eventName = $f.eventName; state = $f.state; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		state = this;
		_r = state.User.update(attrs); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		c = _r;
		$r = state.log(new sliceType$1([new $String(state.User.Id), new $String(new Change(c).String()), new $String("by"), new $String(eventName)])); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* */ if (!((c === 0))) { $s = 3; continue; }
		/* */ $s = 4; continue;
		/* if (!((c === 0))) { */ case 3:
			$r = state.OnChange(c, state.User, ""); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 4:
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: SelfState.ptr.prototype.handleUser }; } $f.$ptr = $ptr; $f._r = _r; $f.attrs = attrs; $f.c = c; $f.eventName = eventName; $f.state = state; $f.$s = $s; $f.$r = $r; return $f;
	};
	SelfState.prototype.handleUser = function(attrs, eventName) { return this.$val.handleUser(attrs, eventName); };
	SelfState.ptr.prototype.log = function(fragments) {
		var $ptr, fragments, state, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; fragments = $f.fragments; state = $f.state; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		state = this;
		$r = log(state.session, "self:", fragments); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: SelfState.ptr.prototype.log }; } $f.$ptr = $ptr; $f.fragments = fragments; $f.state = state; $f.$s = $s; $f.$r = $r; return $f;
	};
	SelfState.prototype.log = function(fragments) { return this.$val.log(fragments); };
	SettingsState.ptr.prototype.init = function(session) {
		var $ptr, session, state;
		state = this;
		state.session = session;
	};
	SettingsState.prototype.init = function(session) { return this.$val.init(session); };
	SettingsState.ptr.prototype.handle = function(settings, eventName) {
		var $ptr, _r, c, eventName, settings, state, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; c = $f.c; eventName = $f.eventName; settings = $f.settings; state = $f.state; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		state = this;
		if (settings === false) {
			return;
		}
		c = 0;
		/* */ if (!(state.Data === false)) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!(state.Data === false)) { */ case 1:
			_r = reflect.DeepEqual(new mapType(state.Data), new mapType(settings)); /* */ $s = 6; case 6: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			/* */ if (!_r) { $s = 4; continue; }
			/* */ $s = 5; continue;
			/* if (!_r) { */ case 4:
				state.Data = settings;
				c = 2;
			/* } */ case 5:
			$s = 3; continue;
		/* } else { */ case 2:
			state.Data = settings;
			c = 1;
		/* } */ case 3:
		$r = state.log(new sliceType$1([new $String(new Change(c).String()), new $String("by"), new $String(eventName)])); /* */ $s = 7; case 7: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* */ if (!((c === 0))) { $s = 8; continue; }
		/* */ $s = 9; continue;
		/* if (!((c === 0))) { */ case 8:
			$r = state.OnChange(c, settings); /* */ $s = 10; case 10: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 9:
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: SettingsState.ptr.prototype.handle }; } $f.$ptr = $ptr; $f._r = _r; $f.c = c; $f.eventName = eventName; $f.settings = settings; $f.state = state; $f.$s = $s; $f.$r = $r; return $f;
	};
	SettingsState.prototype.handle = function(settings, eventName) { return this.$val.handle(settings, eventName); };
	SettingsState.ptr.prototype.log = function(fragments) {
		var $ptr, fragments, state, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; fragments = $f.fragments; state = $f.state; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		state = this;
		$r = log(state.session, "settings:", fragments); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: SettingsState.ptr.prototype.log }; } $f.$ptr = $ptr; $f.fragments = fragments; $f.state = state; $f.$s = $s; $f.$r = $r; return $f;
	};
	SettingsState.prototype.log = function(fragments) { return this.$val.log(fragments); };
	State.ptr.prototype.Open = function() {
		var $ptr, _r, err, initChan, initDone, state, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; err = $f.err; initChan = $f.initChan; initDone = $f.initDone; state = $f.state; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		initChan = [initChan];
		initDone = [initDone];
		state = [state];
		err = $ifaceNil;
		state[0] = this;
		state[0].Self.init(state[0].Session);
		state[0].Settings.init(state[0].Session);
		state[0].Users.init(state[0].Session);
		state[0].Dialogues.init(state[0].Session);
		initChan[0] = new $Chan($error, 1);
		initDone[0] = false;
		state[0].Session.OnSessionEvent = (function(initChan, initDone, state) { return function $b(e) {
			var $ptr, _r, _selection, e, err$1, $s, $r;
			/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _selection = $f._selection; e = $f.e; err$1 = $f.err$1; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
			_r = state[0].handle(e); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			err$1 = _r;
			/* */ if (!initDone[0]) { $s = 2; continue; }
			/* */ if (!($interfaceIsEqual(err$1, $ifaceNil))) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (!initDone[0]) { */ case 2:
				_selection = $select([[initChan[0], err$1], []]);
				if (_selection[0] === 0) {
				} else if (_selection[0] === 1) {
				}
				initDone[0] = true;
				$s = 4; continue;
			/* } else if (!($interfaceIsEqual(err$1, $ifaceNil))) { */ case 3:
				$r = state[0].log(new sliceType$1([new $String("session:"), err$1])); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* } */ case 4:
			/* */ if (!(state[0].OnSessionEvent === $throwNilPointerError)) { $s = 6; continue; }
			/* */ $s = 7; continue;
			/* if (!(state[0].OnSessionEvent === $throwNilPointerError)) { */ case 6:
				$r = state[0].OnSessionEvent(e); /* */ $s = 8; case 8: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* } */ case 7:
			/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f._r = _r; $f._selection = _selection; $f.e = e; $f.err$1 = err$1; $f.$s = $s; $f.$r = $r; return $f;
		}; })(initChan, initDone, state);
		state[0].Session.OnEvent = (function(initChan, initDone, state) { return function $b(e) {
			var $ptr, _r, e, err$1, $s, $r;
			/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; e = $f.e; err$1 = $f.err$1; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
			_r = state[0].handle(e); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			err$1 = _r;
			/* */ if (!($interfaceIsEqual(err$1, $ifaceNil))) { $s = 2; continue; }
			/* */ $s = 3; continue;
			/* if (!($interfaceIsEqual(err$1, $ifaceNil))) { */ case 2:
				$r = state[0].log(new sliceType$1([new $String(e.String()), new $String("event:"), err$1])); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* } */ case 3:
			/* */ if (!(state[0].OnEvent === $throwNilPointerError)) { $s = 5; continue; }
			/* */ $s = 6; continue;
			/* if (!(state[0].OnEvent === $throwNilPointerError)) { */ case 5:
				$r = state[0].OnEvent(e); /* */ $s = 7; case 7: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* } */ case 6:
			/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f._r = _r; $f.e = e; $f.err$1 = err$1; $f.$s = $s; $f.$r = $r; return $f;
		}; })(initChan, initDone, state);
		state[0].Session.Open();
		_r = $recv(initChan[0]); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		err = _r[0];
		/* */ if (!($interfaceIsEqual(err, $ifaceNil))) { $s = 2; continue; }
		/* */ $s = 3; continue;
		/* if (!($interfaceIsEqual(err, $ifaceNil))) { */ case 2:
			$r = state[0].Session.Close(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 3:
		return err;
		/* */ } return; } if ($f === undefined) { $f = { $blk: State.ptr.prototype.Open }; } $f.$ptr = $ptr; $f._r = _r; $f.err = err; $f.initChan = initChan; $f.initDone = initDone; $f.state = state; $f.$s = $s; $f.$r = $r; return $f;
	};
	State.prototype.Open = function() { return this.$val.Open(); };
	State.ptr.prototype.handle = function(clientEvent) {
		var $ptr, _entry, _entry$1, _entry$2, _i, _i$1, _i$2, _key, _keys, _keys$1, _keys$2, _r, _ref, _ref$1, _ref$2, _ref$3, _tuple, clientEvent, d, e, e$1, e$2, e$3, e$4, e$5, e$6, e$7, err, event, initial, peerId, peerId$1, state, $s, $deferred, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _entry = $f._entry; _entry$1 = $f._entry$1; _entry$2 = $f._entry$2; _i = $f._i; _i$1 = $f._i$1; _i$2 = $f._i$2; _key = $f._key; _keys = $f._keys; _keys$1 = $f._keys$1; _keys$2 = $f._keys$2; _r = $f._r; _ref = $f._ref; _ref$1 = $f._ref$1; _ref$2 = $f._ref$2; _ref$3 = $f._ref$3; _tuple = $f._tuple; clientEvent = $f.clientEvent; d = $f.d; e = $f.e; e$1 = $f.e$1; e$2 = $f.e$2; e$3 = $f.e$3; e$4 = $f.e$4; e$5 = $f.e$5; e$6 = $f.e$6; e$7 = $f.e$7; err = $f.err; event = $f.event; initial = $f.initial; peerId = $f.peerId; peerId$1 = $f.peerId$1; state = $f.state; $s = $f.$s; $deferred = $f.$deferred; $r = $f.$r; } var $err = null; try { s: while (true) { switch ($s) { case 0: $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		err = [err];
		state = [state];
		err[0] = $ifaceNil;
		state[0] = this;
		$deferred.push([(function(err, state) { return function $b() {
			var $ptr, x, $s, $r;
			/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
			x = $recover();
			/* */ if (!($interfaceIsEqual(x, $ifaceNil))) { $s = 1; continue; }
			/* */ $s = 2; continue;
			/* if (!($interfaceIsEqual(x, $ifaceNil))) { */ case 1:
				$r = state[0].log(new sliceType$1([new $String("panic during event handling:"), x])); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				err[0] = errors.New("event handler panicked");
			/* } */ case 2:
			/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
		}; })(err, state), []]);
		_r = ninchatapi.NewEvent(clientEvent); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		event = _tuple[0];
		err[0] = _tuple[1];
		if (!($interfaceIsEqual(err[0], $ifaceNil))) {
			return err[0];
		}
		_ref = event;
		/* */ if ($assertType(_ref, ptrType$7, true)[1]) { $s = 2; continue; }
		/* */ if ($assertType(_ref, ptrType$8, true)[1]) { $s = 3; continue; }
		/* */ if ($assertType(_ref, ptrType$9, true)[1]) { $s = 4; continue; }
		/* */ if ($assertType(_ref, ptrType$10, true)[1]) { $s = 5; continue; }
		/* */ if ($assertType(_ref, ptrType$11, true)[1]) { $s = 6; continue; }
		/* */ if ($assertType(_ref, ptrType$12, true)[1]) { $s = 7; continue; }
		/* */ if ($assertType(_ref, ptrType$13, true)[1]) { $s = 8; continue; }
		/* */ if ($assertType(_ref, ptrType$14, true)[1]) { $s = 9; continue; }
		/* */ $s = 10; continue;
		/* if ($assertType(_ref, ptrType$7, true)[1]) { */ case 2:
			e = _ref.$val;
			err[0] = e;
			$s = 10; continue;
		/* } else if ($assertType(_ref, ptrType$8, true)[1]) { */ case 3:
			e$1 = _ref.$val;
			initial = state[0].Self.User.Id === "";
			if (initial) {
				_key = e$1.UserId; (state[0].Users.Map || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key)] = { k: _key, v: state[0].Self.User };
			}
			$r = state[0].Self.handleSession(e$1); /* */ $s = 11; case 11: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			$r = state[0].Settings.handle(e$1.UserSettings, e$1.String()); /* */ $s = 12; case 12: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			_ref$1 = e$1.UserDialogues;
			_i = 0;
			_keys = $keys(_ref$1);
			/* while (true) { */ case 13:
				/* if (!(_i < _keys.length)) { break; } */ if(!(_i < _keys.length)) { $s = 14; continue; }
				_entry = _ref$1[_keys[_i]];
				if (_entry === undefined) {
					_i++;
					/* continue; */ $s = 13; continue;
				}
				peerId = _entry.k;
				$r = state[0].Users.discover(peerId, true); /* */ $s = 15; case 15: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				_i++;
			/* } */ $s = 13; continue; case 14:
			$r = state[0].Dialogues.handleUser(state[0].Self.User.Id, e$1.UserDialogues, e$1.String()); /* */ $s = 16; case 16: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* */ if (!initial) { $s = 17; continue; }
			/* */ $s = 18; continue;
			/* if (!initial) { */ case 17:
				_ref$2 = state[0].Dialogues.Map;
				_i$1 = 0;
				_keys$1 = $keys(_ref$2);
				/* while (true) { */ case 19:
					/* if (!(_i$1 < _keys$1.length)) { break; } */ if(!(_i$1 < _keys$1.length)) { $s = 20; continue; }
					_entry$1 = _ref$2[_keys$1[_i$1]];
					if (_entry$1 === undefined) {
						_i$1++;
						/* continue; */ $s = 19; continue;
					}
					d = _entry$1.v;
					$r = d.Window.handleSecondarySession(state[0].Session, d); /* */ $s = 21; case 21: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					_i$1++;
				/* } */ $s = 19; continue; case 20:
			/* } */ case 18:
			$s = 10; continue;
		/* } else if ($assertType(_ref, ptrType$9, true)[1]) { */ case 4:
			e$2 = _ref.$val;
			/* */ if (!(e$2.UserId === ptrType.nil)) { $s = 22; continue; }
			/* */ $s = 23; continue;
			/* if (!(e$2.UserId === ptrType.nil)) { */ case 22:
				$r = state[0].Dialogues.handleSessionStatus(e$2); /* */ $s = 24; case 24: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* } */ case 23:
			$s = 10; continue;
		/* } else if ($assertType(_ref, ptrType$10, true)[1]) { */ case 5:
			e$3 = _ref.$val;
			/* */ if (e$3.UserId === state[0].Self.User.Id) { $s = 25; continue; }
			/* */ $s = 26; continue;
			/* if (e$3.UserId === state[0].Self.User.Id) { */ case 25:
				$r = state[0].Self.handleUser(e$3.UserAttrs, e$3.String()); /* */ $s = 28; case 28: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				$r = state[0].Settings.handle(e$3.UserSettings, e$3.String()); /* */ $s = 29; case 29: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				_ref$3 = e$3.UserDialogues;
				_i$2 = 0;
				_keys$2 = $keys(_ref$3);
				/* while (true) { */ case 30:
					/* if (!(_i$2 < _keys$2.length)) { break; } */ if(!(_i$2 < _keys$2.length)) { $s = 31; continue; }
					_entry$2 = _ref$3[_keys$2[_i$2]];
					if (_entry$2 === undefined) {
						_i$2++;
						/* continue; */ $s = 30; continue;
					}
					peerId$1 = _entry$2.k;
					$r = state[0].Users.discover(peerId$1, false); /* */ $s = 32; case 32: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					_i$2++;
				/* } */ $s = 30; continue; case 31:
				$r = state[0].Dialogues.handleUser(state[0].Self.User.Id, e$3.UserDialogues, e$3.String()); /* */ $s = 33; case 33: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				$s = 27; continue;
			/* } else { */ case 26:
				$r = state[0].Users.handle(e$3.UserId, e$3.UserAttrs, e$3.String()); /* */ $s = 34; case 34: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* } */ case 27:
			$s = 10; continue;
		/* } else if ($assertType(_ref, ptrType$11, true)[1]) { */ case 6:
			e$4 = _ref.$val;
			/* */ if (e$4.UserId === state[0].Self.User.Id) { $s = 35; continue; }
			/* */ $s = 36; continue;
			/* if (e$4.UserId === state[0].Self.User.Id) { */ case 35:
				$r = state[0].Self.handleUser(e$4.UserAttrs, e$4.String()); /* */ $s = 38; case 38: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				$r = state[0].Settings.handle(e$4.UserSettings, e$4.String()); /* */ $s = 39; case 39: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				$s = 37; continue;
			/* } else { */ case 36:
				$r = state[0].Users.handle(e$4.UserId, e$4.UserAttrs, e$4.String()); /* */ $s = 40; case 40: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* } */ case 37:
			$s = 10; continue;
		/* } else if ($assertType(_ref, ptrType$12, true)[1]) { */ case 7:
			e$5 = _ref.$val;
			/* */ if (!(e$5.DialogueStatus === ptrType.nil)) { $s = 41; continue; }
			/* */ $s = 42; continue;
			/* if (!(e$5.DialogueStatus === ptrType.nil)) { */ case 41:
				$r = state[0].Users.discover(e$5.UserId, false); /* */ $s = 43; case 43: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* } */ case 42:
			$r = state[0].Dialogues.handleDialogue(state[0].Self.User.Id, e$5); /* */ $s = 44; case 44: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			$s = 10; continue;
		/* } else if ($assertType(_ref, ptrType$13, true)[1]) { */ case 8:
			e$6 = _ref.$val;
			/* */ if (!(e$6.MessageUserId === ptrType.nil)) { $s = 45; continue; }
			/* */ $s = 46; continue;
			/* if (!(e$6.MessageUserId === ptrType.nil)) { */ case 45:
				$r = state[0].Users.discover(e$6.MessageUserId.$get(), false); /* */ $s = 47; case 47: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* } */ case 46:
			/* */ if (!(e$6.UserId === ptrType.nil)) { $s = 48; continue; }
			/* */ $s = 49; continue;
			/* if (!(e$6.UserId === ptrType.nil)) { */ case 48:
				$r = state[0].Users.discover(e$6.UserId.$get(), false); /* */ $s = 50; case 50: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				$r = state[0].Dialogues.handleReceive(state[0].Self.User.Id, e$6); /* */ $s = 51; case 51: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* } */ case 49:
			$s = 10; continue;
		/* } else if ($assertType(_ref, ptrType$14, true)[1]) { */ case 9:
			e$7 = _ref.$val;
		/* } */ case 10:
		return err[0];
		/* */ } return; } } catch(err) { $err = err; $s = -1; } finally { $callDeferred($deferred, $err); if (!$curGoroutine.asleep) { return  err[0]; } if($curGoroutine.asleep) { if ($f === undefined) { $f = { $blk: State.ptr.prototype.handle }; } $f.$ptr = $ptr; $f._entry = _entry; $f._entry$1 = _entry$1; $f._entry$2 = _entry$2; $f._i = _i; $f._i$1 = _i$1; $f._i$2 = _i$2; $f._key = _key; $f._keys = _keys; $f._keys$1 = _keys$1; $f._keys$2 = _keys$2; $f._r = _r; $f._ref = _ref; $f._ref$1 = _ref$1; $f._ref$2 = _ref$2; $f._ref$3 = _ref$3; $f._tuple = _tuple; $f.clientEvent = clientEvent; $f.d = d; $f.e = e; $f.e$1 = e$1; $f.e$2 = e$2; $f.e$3 = e$3; $f.e$4 = e$4; $f.e$5 = e$5; $f.e$6 = e$6; $f.e$7 = e$7; $f.err = err; $f.event = event; $f.initial = initial; $f.peerId = peerId; $f.peerId$1 = peerId$1; $f.state = state; $f.$s = $s; $f.$deferred = $deferred; $f.$r = $r; return $f; } }
	};
	State.prototype.handle = function(clientEvent) { return this.$val.handle(clientEvent); };
	State.ptr.prototype.log = function(fragments) {
		var $ptr, fragments, state, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; fragments = $f.fragments; state = $f.state; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		state = this;
		/* */ if (!(state.Session.OnLog === $throwNilPointerError)) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!(state.Session.OnLog === $throwNilPointerError)) { */ case 1:
			$r = state.Session.OnLog(fragments); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 2:
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: State.ptr.prototype.log }; } $f.$ptr = $ptr; $f.fragments = fragments; $f.state = state; $f.$s = $s; $f.$r = $r; return $f;
	};
	State.prototype.log = function(fragments) { return this.$val.log(fragments); };
	log = function(session, prefix, fragments) {
		var $ptr, fragments, prefix, session, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; fragments = $f.fragments; prefix = $f.prefix; session = $f.session; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		/* */ if (!(session.OnLog === $throwNilPointerError)) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!(session.OnLog === $throwNilPointerError)) { */ case 1:
			fragments = $appendSlice(new sliceType$1([new $String(prefix)]), fragments);
			$r = session.OnLog(fragments); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 2:
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: log }; } $f.$ptr = $ptr; $f.fragments = fragments; $f.prefix = prefix; $f.session = session; $f.$s = $s; $f.$r = $r; return $f;
	};
	compareStatus = function(a, b) {
		var $ptr, _entry, _entry$1, a, b;
		return (_entry = numericStatuses[$String.keyFor(a)], _entry !== undefined ? _entry.v : 0) - (_entry$1 = numericStatuses[$String.keyFor(b)], _entry$1 !== undefined ? _entry$1.v : 0) >> 0;
	};
	newUser = function(id, attrs) {
		var $ptr, attrs, id;
		return new User.ptr(new Aux.ptr(false), id, attrs);
	};
	User.ptr.prototype.update = function(attrs) {
		var $ptr, _r, attrs, c, user, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; attrs = $f.attrs; c = $f.c; user = $f.user; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		c = 0;
		user = this;
		_r = reflect.DeepEqual(user.Attrs, attrs); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ if (!_r) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!_r) { */ case 1:
			user.Attrs = attrs;
			c = 2;
		/* } */ case 2:
		return c;
		/* */ } return; } if ($f === undefined) { $f = { $blk: User.ptr.prototype.update }; } $f.$ptr = $ptr; $f._r = _r; $f.attrs = attrs; $f.c = c; $f.user = user; $f.$s = $s; $f.$r = $r; return $f;
	};
	User.prototype.update = function(attrs) { return this.$val.update(attrs); };
	UserState.ptr.prototype.init = function(session) {
		var $ptr, session, state;
		state = this;
		state.session = session;
		state.Map = {};
	};
	UserState.prototype.init = function(session) { return this.$val.init(session); };
	UserState.ptr.prototype.handle = function(id, attrs, eventName) {
		var $ptr, _entry, _key, _r, attrs, c, eventName, id, state, user, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _entry = $f._entry; _key = $f._key; _r = $f._r; attrs = $f.attrs; c = $f.c; eventName = $f.eventName; id = $f.id; state = $f.state; user = $f.user; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		state = this;
		c = 0;
		user = (_entry = state.Map[$String.keyFor(id)], _entry !== undefined ? _entry.v : ptrType$16.nil);
		/* */ if (!(user === ptrType$16.nil)) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!(user === ptrType$16.nil)) { */ case 1:
			_r = user.update(attrs); /* */ $s = 4; case 4: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			c = _r;
			$s = 3; continue;
		/* } else { */ case 2:
			user = newUser(id, attrs);
			_key = id; (state.Map || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key)] = { k: _key, v: user };
			c = 1;
		/* } */ case 3:
		$r = state.log(new sliceType$1([new $String(id), new $String(new Change(c).String()), new $String("by"), new $String(eventName)])); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* */ if (!((c === 0))) { $s = 6; continue; }
		/* */ $s = 7; continue;
		/* if (!((c === 0))) { */ case 6:
			$r = state.OnChange(c, user); /* */ $s = 8; case 8: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 7:
		return;
		/* */ } return; } if ($f === undefined) { $f = { $blk: UserState.ptr.prototype.handle }; } $f.$ptr = $ptr; $f._entry = _entry; $f._key = _key; $f._r = _r; $f.attrs = attrs; $f.c = c; $f.eventName = eventName; $f.id = id; $f.state = state; $f.user = user; $f.$s = $s; $f.$r = $r; return $f;
	};
	UserState.prototype.handle = function(id, attrs, eventName) { return this.$val.handle(id, attrs, eventName); };
	UserState.ptr.prototype.discover = function(id, rediscover) {
		var $ptr, _entry, _r, id, rediscover, state, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _entry = $f._entry; _r = $f._r; id = $f.id; rediscover = $f.rediscover; state = $f.state; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		id = [id];
		state = this;
		/* */ if (rediscover || (_entry = state.Map[$String.keyFor(id[0])], _entry !== undefined ? _entry.v : ptrType$16.nil) === ptrType$16.nil) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (rediscover || (_entry = state.Map[$String.keyFor(id[0])], _entry !== undefined ? _entry.v : ptrType$16.nil) === ptrType$16.nil) { */ case 1:
			_r = ninchatapi.Send(state.session, new ninchatapi.DescribeUser.ptr((id.$ptr || (id.$ptr = new ptrType(function() { return this.$target[0]; }, function($v) { this.$target[0] = $v; }, id))))); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			_r;
		/* } */ case 2:
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: UserState.ptr.prototype.discover }; } $f.$ptr = $ptr; $f._entry = _entry; $f._r = _r; $f.id = id; $f.rediscover = rediscover; $f.state = state; $f.$s = $s; $f.$r = $r; return $f;
	};
	UserState.prototype.discover = function(id, rediscover) { return this.$val.discover(id, rediscover); };
	UserState.ptr.prototype.log = function(fragments) {
		var $ptr, fragments, state, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; fragments = $f.fragments; state = $f.state; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		state = this;
		$r = log(state.session, "user:", fragments); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: UserState.ptr.prototype.log }; } $f.$ptr = $ptr; $f.fragments = fragments; $f.state = state; $f.$s = $s; $f.$r = $r; return $f;
	};
	UserState.prototype.log = function(fragments) { return this.$val.log(fragments); };
	ptrType$17.methods = [{prop: "GetAux", name: "GetAux", pkg: "", typ: $funcType([$emptyInterface], [$emptyInterface], false)}, {prop: "SetAux", name: "SetAux", pkg: "", typ: $funcType([$emptyInterface, $emptyInterface], [], false)}];
	Change.methods = [{prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$2.methods = [{prop: "update", name: "update", pkg: "github.com/ninchat/ninchat-go/ninchatmodel", typ: $funcType([$String, ptrType$4, ptrType$4, mapType], [Change], false)}, {prop: "updateStatus", name: "updateStatus", pkg: "github.com/ninchat/ninchat-go/ninchatmodel", typ: $funcType([$String], [Change], false)}, {prop: "updateStatusIfHigher", name: "updateStatusIfHigher", pkg: "github.com/ninchat/ninchat-go/ninchatmodel", typ: $funcType([$String], [Change], false)}, {prop: "updateStatusIfLower", name: "updateStatusIfLower", pkg: "github.com/ninchat/ninchat-go/ninchatmodel", typ: $funcType([$String], [Change], false)}, {prop: "updateStatusIfRead", name: "updateStatusIfRead", pkg: "github.com/ninchat/ninchat-go/ninchatmodel", typ: $funcType([$String], [Change], false)}, {prop: "newLoadHistoryAction", name: "newLoadHistoryAction", pkg: "github.com/ninchat/ninchat-go/ninchatmodel", typ: $funcType([], [ptrType$18], false)}];
	ptrType$20.methods = [{prop: "init", name: "init", pkg: "github.com/ninchat/ninchat-go/ninchatmodel", typ: $funcType([ptrType$19], [], false)}, {prop: "handleSessionStatus", name: "handleSessionStatus", pkg: "github.com/ninchat/ninchat-go/ninchatmodel", typ: $funcType([ptrType$9], [], false)}, {prop: "handleUser", name: "handleUser", pkg: "github.com/ninchat/ninchat-go/ninchatmodel", typ: $funcType([$String, mapType$2, $String], [], false)}, {prop: "handleDialogue", name: "handleDialogue", pkg: "github.com/ninchat/ninchat-go/ninchatmodel", typ: $funcType([$String, ptrType$12], [], false)}, {prop: "handleReceive", name: "handleReceive", pkg: "github.com/ninchat/ninchat-go/ninchatmodel", typ: $funcType([$String, ptrType$13], [], false)}, {prop: "LoadEarlier", name: "LoadEarlier", pkg: "", typ: $funcType([$String], [chanType], false)}, {prop: "UpdateStatus", name: "UpdateStatus", pkg: "", typ: $funcType([ptrType$2, $String], [], false)}, {prop: "Activate", name: "Activate", pkg: "", typ: $funcType([ptrType$2], [], false)}, {prop: "Discard", name: "Discard", pkg: "", typ: $funcType([ptrType$2], [], false)}, {prop: "log", name: "log", pkg: "github.com/ninchat/ninchat-go/ninchatmodel", typ: $funcType([sliceType$1], [], true)}];
	ptrType$21.methods = [{prop: "GetAux", name: "GetAux", pkg: "", typ: $funcType([$emptyInterface], [$emptyInterface], false)}, {prop: "SetAux", name: "SetAux", pkg: "", typ: $funcType([$emptyInterface, $emptyInterface], [], false)}, {prop: "IsActive", name: "IsActive", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "activate", name: "activate", pkg: "github.com/ninchat/ninchat-go/ninchatmodel", typ: $funcType([ptrType$19, messageGroup], [], false)}, {prop: "Deactivate", name: "Deactivate", pkg: "", typ: $funcType([], [], false)}, {prop: "GetLength", name: "GetLength", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "HasEarliest", name: "HasEarliest", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "gotEarliest", name: "gotEarliest", pkg: "github.com/ninchat/ninchat-go/ninchatmodel", typ: $funcType([], [], false)}, {prop: "getLatestId", name: "getLatestId", pkg: "github.com/ninchat/ninchat-go/ninchatmodel", typ: $funcType([], [$String], false)}, {prop: "indexOf", name: "indexOf", pkg: "github.com/ninchat/ninchat-go/ninchatmodel", typ: $funcType([$String], [$Int, $Bool], false)}, {prop: "handleSecondarySession", name: "handleSecondarySession", pkg: "github.com/ninchat/ninchat-go/ninchatmodel", typ: $funcType([ptrType$19, messageGroup], [], false)}, {prop: "prepareReceive", name: "prepareReceive", pkg: "github.com/ninchat/ninchat-go/ninchatmodel", typ: $funcType([ptrType$13], [$Bool], false)}, {prop: "loadEarlier", name: "loadEarlier", pkg: "github.com/ninchat/ninchat-go/ninchatmodel", typ: $funcType([ptrType$19, ptrType$18], [chanType], false)}, {prop: "loadMissing", name: "loadMissing", pkg: "github.com/ninchat/ninchat-go/ninchatmodel", typ: $funcType([ptrType$19, messageGroup], [], false)}];
	ptrType$22.methods = [{prop: "init", name: "init", pkg: "github.com/ninchat/ninchat-go/ninchatmodel", typ: $funcType([ptrType$19, $String], [], false)}, {prop: "handleReceive", name: "handleReceive", pkg: "github.com/ninchat/ninchat-go/ninchatmodel", typ: $funcType([$String, ptrType$21, ptrType$13], [], false)}, {prop: "handleUpdate", name: "handleUpdate", pkg: "github.com/ninchat/ninchat-go/ninchatmodel", typ: $funcType([$String, ptrType$21, ptrType$14], [], false)}, {prop: "log", name: "log", pkg: "github.com/ninchat/ninchat-go/ninchatmodel", typ: $funcType([$String, sliceType$1], [], true)}];
	ptrType$23.methods = [{prop: "init", name: "init", pkg: "github.com/ninchat/ninchat-go/ninchatmodel", typ: $funcType([ptrType$19], [], false)}, {prop: "handleSession", name: "handleSession", pkg: "github.com/ninchat/ninchat-go/ninchatmodel", typ: $funcType([ptrType$8], [], false)}, {prop: "handleUser", name: "handleUser", pkg: "github.com/ninchat/ninchat-go/ninchatmodel", typ: $funcType([ptrType$15, $String], [], false)}, {prop: "log", name: "log", pkg: "github.com/ninchat/ninchat-go/ninchatmodel", typ: $funcType([sliceType$1], [], true)}];
	ptrType$24.methods = [{prop: "init", name: "init", pkg: "github.com/ninchat/ninchat-go/ninchatmodel", typ: $funcType([ptrType$19], [], false)}, {prop: "handle", name: "handle", pkg: "github.com/ninchat/ninchat-go/ninchatmodel", typ: $funcType([mapType, $String], [], false)}, {prop: "log", name: "log", pkg: "github.com/ninchat/ninchat-go/ninchatmodel", typ: $funcType([sliceType$1], [], true)}];
	ptrType$27.methods = [{prop: "Open", name: "Open", pkg: "", typ: $funcType([], [$error], false)}, {prop: "handle", name: "handle", pkg: "github.com/ninchat/ninchat-go/ninchatmodel", typ: $funcType([ptrType$26], [$error], false)}, {prop: "log", name: "log", pkg: "github.com/ninchat/ninchat-go/ninchatmodel", typ: $funcType([sliceType$1], [], true)}];
	ptrType$16.methods = [{prop: "update", name: "update", pkg: "github.com/ninchat/ninchat-go/ninchatmodel", typ: $funcType([ptrType$15], [Change], false)}];
	ptrType$28.methods = [{prop: "init", name: "init", pkg: "github.com/ninchat/ninchat-go/ninchatmodel", typ: $funcType([ptrType$19], [], false)}, {prop: "handle", name: "handle", pkg: "github.com/ninchat/ninchat-go/ninchatmodel", typ: $funcType([$String, ptrType$15, $String], [], false)}, {prop: "discover", name: "discover", pkg: "github.com/ninchat/ninchat-go/ninchatmodel", typ: $funcType([$String, $Bool], [], false)}, {prop: "log", name: "log", pkg: "github.com/ninchat/ninchat-go/ninchatmodel", typ: $funcType([sliceType$1], [], true)}];
	Aux.init([{prop: "m", name: "m", pkg: "github.com/ninchat/ninchat-go/ninchatmodel", typ: mapType$1, tag: ""}]);
	Dialogue.init([{prop: "PeerId", name: "PeerId", pkg: "", typ: $String, tag: ""}, {prop: "Status", name: "Status", pkg: "", typ: $String, tag: ""}, {prop: "SelfMemberAttrs", name: "SelfMemberAttrs", pkg: "", typ: ptrType$4, tag: ""}, {prop: "PeerMemberAttrs", name: "PeerMemberAttrs", pkg: "", typ: ptrType$4, tag: ""}, {prop: "AudienceMetadata", name: "AudienceMetadata", pkg: "", typ: mapType, tag: ""}, {prop: "Window", name: "Window", pkg: "", typ: MessageWindow, tag: ""}]);
	DialogueState.init([{prop: "Messages", name: "Messages", pkg: "", typ: MessageState, tag: ""}, {prop: "OnChange", name: "OnChange", pkg: "", typ: funcType, tag: ""}, {prop: "Map", name: "Map", pkg: "", typ: mapType$3, tag: ""}, {prop: "session", name: "session", pkg: "github.com/ninchat/ninchat-go/ninchatmodel", typ: ptrType$19, tag: ""}]);
	messageGroup.init([{prop: "newLoadHistoryAction", name: "newLoadHistoryAction", pkg: "github.com/ninchat/ninchat-go/ninchatmodel", typ: $funcType([], [ptrType$18], false)}]);
	MessageWindow.init([{prop: "Aux", name: "", pkg: "", typ: Aux, tag: ""}, {prop: "active", name: "active", pkg: "github.com/ninchat/ninchat-go/ninchatmodel", typ: $Bool, tag: ""}, {prop: "missing", name: "missing", pkg: "github.com/ninchat/ninchat-go/ninchatmodel", typ: $Bool, tag: ""}, {prop: "missingSince", name: "missingSince", pkg: "github.com/ninchat/ninchat-go/ninchatmodel", typ: $String, tag: ""}, {prop: "ids", name: "ids", pkg: "github.com/ninchat/ninchat-go/ninchatmodel", typ: sliceType, tag: ""}, {prop: "minLoadedId", name: "minLoadedId", pkg: "github.com/ninchat/ninchat-go/ninchatmodel", typ: $String, tag: ""}, {prop: "maxLoadedId", name: "maxLoadedId", pkg: "github.com/ninchat/ninchat-go/ninchatmodel", typ: $String, tag: ""}, {prop: "earliest", name: "earliest", pkg: "github.com/ninchat/ninchat-go/ninchatmodel", typ: $Int32, tag: ""}]);
	MessageState.init([{prop: "OnReceive", name: "OnReceive", pkg: "", typ: funcType$1, tag: ""}, {prop: "OnUpdate", name: "OnUpdate", pkg: "", typ: funcType$2, tag: ""}, {prop: "session", name: "session", pkg: "github.com/ninchat/ninchat-go/ninchatmodel", typ: ptrType$19, tag: ""}, {prop: "groupType", name: "groupType", pkg: "github.com/ninchat/ninchat-go/ninchatmodel", typ: $String, tag: ""}]);
	SelfState.init([{prop: "User", name: "", pkg: "", typ: User, tag: ""}, {prop: "OnChange", name: "OnChange", pkg: "", typ: funcType$3, tag: ""}, {prop: "session", name: "session", pkg: "github.com/ninchat/ninchat-go/ninchatmodel", typ: ptrType$19, tag: ""}]);
	SettingsState.init([{prop: "OnChange", name: "OnChange", pkg: "", typ: funcType$4, tag: ""}, {prop: "Data", name: "Data", pkg: "", typ: mapType, tag: ""}, {prop: "session", name: "session", pkg: "github.com/ninchat/ninchat-go/ninchatmodel", typ: ptrType$19, tag: ""}]);
	State.init([{prop: "Session", name: "", pkg: "", typ: ninchat.Session, tag: ""}, {prop: "Self", name: "Self", pkg: "", typ: SelfState, tag: ""}, {prop: "Settings", name: "Settings", pkg: "", typ: SettingsState, tag: ""}, {prop: "Users", name: "Users", pkg: "", typ: UserState, tag: ""}, {prop: "Dialogues", name: "Dialogues", pkg: "", typ: DialogueState, tag: ""}, {prop: "OnSessionEvent", name: "OnSessionEvent", pkg: "", typ: funcType$5, tag: ""}, {prop: "OnEvent", name: "OnEvent", pkg: "", typ: funcType$5, tag: ""}]);
	User.init([{prop: "Aux", name: "", pkg: "", typ: Aux, tag: ""}, {prop: "Id", name: "Id", pkg: "", typ: $String, tag: ""}, {prop: "Attrs", name: "Attrs", pkg: "", typ: ptrType$15, tag: ""}]);
	UserState.init([{prop: "OnChange", name: "OnChange", pkg: "", typ: funcType$6, tag: ""}, {prop: "Map", name: "Map", pkg: "", typ: mapType$4, tag: ""}, {prop: "session", name: "session", pkg: "github.com/ninchat/ninchat-go/ninchatmodel", typ: ptrType$19, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = errors.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = ninchat.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = ninchatapi.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = reflect.$init(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = sort.$init(); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = strings.$init(); /* */ $s = 6; case 6: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = atomic.$init(); /* */ $s = 7; case 7: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		numericStatuses = $makeMap($String.keyFor, [{ k: "hidden", v: 1 }, { k: "visible", v: 2 }, { k: "unread", v: 3 }, { k: "highlight", v: 4 }]);
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["ninchatclient/lib"] = (function() {
	var $pkg = {}, $init, js, ninchat, Promise, SessionAdapter, ptrType, sliceType, sliceType$1, mapType, sliceType$2, sliceType$3, funcType, funcType$1, funcType$2, funcType$3, ptrType$1, ptrType$2, ptrType$3, sliceType$4, funcType$4, funcType$5, funcType$6, funcType$7, funcType$8, ptrType$4, funcType$9, ptrType$5, call, Init, Panicer, WrapPayload, UnwrapPayload, NewSessionAdapter, newSession;
	js = $packages["github.com/gopherjs/gopherjs/js"];
	ninchat = $packages["github.com/ninchat/ninchat-go"];
	Promise = $pkg.Promise = $newType(0, $kindStruct, "clientlib.Promise", "Promise", "ninchatclient/lib", function(OnPanic_, fulfillers_, rejecters_, notifiers_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.OnPanic = $throwNilPointerError;
			this.fulfillers = sliceType.nil;
			this.rejecters = sliceType.nil;
			this.notifiers = sliceType.nil;
			return;
		}
		this.OnPanic = OnPanic_;
		this.fulfillers = fulfillers_;
		this.rejecters = rejecters_;
		this.notifiers = notifiers_;
	});
	SessionAdapter = $pkg.SessionAdapter = $newType(0, $kindStruct, "clientlib.SessionAdapter", "SessionAdapter", "ninchatclient/lib", function(Session_, OnPanic_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Session = ptrType$2.nil;
			this.OnPanic = $throwNilPointerError;
			return;
		}
		this.Session = Session_;
		this.OnPanic = OnPanic_;
	});
	ptrType = $ptrType(js.Object);
	sliceType = $sliceType(ptrType);
	sliceType$1 = $sliceType(ninchat.Frame);
	mapType = $mapType($String, $emptyInterface);
	sliceType$2 = $sliceType(mapType);
	sliceType$3 = $sliceType($emptyInterface);
	funcType = $funcType([mapType, ptrType, $String], [ptrType], false);
	funcType$1 = $funcType([], [mapType], false);
	funcType$2 = $funcType([ptrType], [ptrType], false);
	funcType$3 = $funcType([ptrType, ptrType, ptrType], [ptrType], false);
	ptrType$1 = $ptrType(ninchat.Event);
	ptrType$2 = $ptrType(ninchat.Session);
	ptrType$3 = $ptrType(ninchat.Action);
	sliceType$4 = $sliceType(ptrType$3);
	funcType$4 = $funcType([ptrType], [], false);
	funcType$5 = $funcType([mapType], [], false);
	funcType$6 = $funcType([$String], [], false);
	funcType$7 = $funcType([], [], false);
	funcType$8 = $funcType([mapType, ptrType], [ptrType], false);
	ptrType$4 = $ptrType(Promise);
	funcType$9 = $funcType([$String, $emptyInterface], [], false);
	ptrType$5 = $ptrType(SessionAdapter);
	call = function(params, onLog, address) {
		var $ptr, address, onLog, p, params;
		p = new Promise.ptr(Panicer((function() {
			var $ptr;
			return (function(msg) {
				var $ptr, msg;
				onLog($externalize(msg, $String));
			});
		})), sliceType.nil, sliceType.nil, sliceType.nil);
		$go((function $b() {
			var $ptr, _i, _r, _r$1, _ref, _tuple, action, caller, e, err, events, paramsArray, reason, $s, $r;
			/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _i = $f._i; _r = $f._r; _r$1 = $f._r$1; _ref = $f._ref; _tuple = $f._tuple; action = $f.action; caller = $f.caller; e = $f.e; err = $f.err; events = $f.events; paramsArray = $f.paramsArray; reason = $f.reason; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
			caller = new ninchat.Caller.ptr(address);
			action = new ninchat.Action.ptr(params, sliceType$1.nil, $throwNilPointerError, new $Int64(0, 0));
			_r = caller.Call(action); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			_tuple = _r;
			events = _tuple[0];
			err = _tuple[1];
			/* */ if (!($interfaceIsEqual(err, $ifaceNil))) { $s = 2; continue; }
			/* */ $s = 3; continue;
			/* if (!($interfaceIsEqual(err, $ifaceNil))) { */ case 2:
				_r$1 = err.Error(); /* */ $s = 4; case 4: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
				reason = _r$1;
				onLog($externalize(reason, $String));
				$r = p.OnReply(new ninchat.Event.ptr($makeMap($String.keyFor, [{ k: "event", v: new $String("error") }, { k: "error_type", v: new $String("internal") }, { k: "error_reason", v: new $String(reason) }]), sliceType$1.nil, false)); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				return;
			/* } */ case 3:
			paramsArray = sliceType$2.nil;
			_ref = events;
			_i = 0;
			while (true) {
				if (!(_i < _ref.$length)) { break; }
				e = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
				paramsArray = $append(paramsArray, e.Params);
				_i++;
			}
			$r = p.Resolve(new sliceType$3([paramsArray])); /* */ $s = 6; case 6: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f._i = _i; $f._r = _r; $f._r$1 = _r$1; $f._ref = _ref; $f._tuple = _tuple; $f.action = action; $f.caller = caller; $f.e = e; $f.err = err; $f.events = events; $f.paramsArray = paramsArray; $f.reason = reason; $f.$s = $s; $f.$r = $r; return $f;
		}), []);
		return p.Object();
	};
	Init = function(module) {
		var $ptr, module;
		module.call = $externalize(call, funcType);
		module.newSession = $externalize(newSession, funcType$1);
		module.stringifyFrame = $externalize(ninchat.StringifyFrame, funcType$2);
	};
	$pkg.Init = Init;
	Panicer = function(getLogger) {
		var $ptr, getLogger;
		return (function $b(prefix, x) {
			var $ptr, _r, _r$1, _ref, logFunc, msg, prefix, t, t$1, t$2, x, $s, $r;
			/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _ref = $f._ref; logFunc = $f.logFunc; msg = $f.msg; prefix = $f.prefix; t = $f.t; t$1 = $f.t$1; t$2 = $f.t$2; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
			/* */ if (!($interfaceIsEqual(x, $ifaceNil))) { $s = 1; continue; }
			/* */ $s = 2; continue;
			/* if (!($interfaceIsEqual(x, $ifaceNil))) { */ case 1:
				_r = getLogger(); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				logFunc = _r;
				/* */ if (!(logFunc === $throwNilPointerError)) { $s = 4; continue; }
				/* */ $s = 5; continue;
				/* if (!(logFunc === $throwNilPointerError)) { */ case 4:
					msg = "";
					_ref = x;
					/* */ if ($assertType(_ref, $String, true)[1]) { $s = 6; continue; }
					/* */ if ($assertType(_ref, $error, true)[1]) { $s = 7; continue; }
					/* */ $s = 8; continue;
					/* if ($assertType(_ref, $String, true)[1]) { */ case 6:
						t = _ref.$val;
						msg = t;
						$s = 9; continue;
					/* } else if ($assertType(_ref, $error, true)[1]) { */ case 7:
						t$1 = _ref;
						_r$1 = t$1.Error(); /* */ $s = 10; case 10: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
						msg = _r$1;
						$s = 9; continue;
					/* } else { */ case 8:
						t$2 = _ref;
						msg = $internalize($global.JSON.stringify($externalize(t$2, $emptyInterface)), $String);
					/* } */ case 9:
					$r = logFunc(prefix + " " + msg); /* */ $s = 11; case 11: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				/* } */ case 5:
			/* } */ case 2:
			/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._ref = _ref; $f.logFunc = logFunc; $f.msg = msg; $f.prefix = prefix; $f.t = t; $f.t$1 = t$1; $f.t$2 = t$2; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
		});
	};
	$pkg.Panicer = Panicer;
	WrapPayload = function(input) {
		var $ptr, i, input, output;
		output = sliceType$1.nil;
		if (!(input === null) && !(input === undefined)) {
			i = 0;
			while (true) {
				if (!(i < $parseInt(input.length))) { break; }
				output = $append(output, input[i]);
				i = i + (1) >> 0;
			}
		}
		return output;
	};
	$pkg.WrapPayload = WrapPayload;
	UnwrapPayload = function(input) {
		var $ptr, _i, _ref, frame, input, output;
		output = sliceType.nil;
		_ref = input;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			frame = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			output = $append(output, frame);
			_i++;
		}
		return output;
	};
	$pkg.UnwrapPayload = UnwrapPayload;
	Promise.ptr.prototype.Object = function() {
		var $ptr, o, p;
		o = null;
		p = this;
		o = new ($global.Object)();
		o.then = $externalize((function(onFulfilled, onRejected, onNotified) {
			var $ptr, onFulfilled, onNotified, onRejected;
			if (!(onFulfilled === null) && !(onFulfilled === undefined)) {
				p.fulfillers = $append(p.fulfillers, onFulfilled);
			}
			if (!(onRejected === null) && !(onRejected === undefined)) {
				p.rejecters = $append(p.rejecters, onRejected);
			}
			if (!(onNotified === null) && !(onNotified === undefined)) {
				p.notifiers = $append(p.notifiers, onNotified);
			}
			return o;
		}), funcType$3);
		return o;
	};
	Promise.prototype.Object = function() { return this.$val.Object(); };
	Promise.ptr.prototype.OnReply = function(e) {
		var $ptr, e, p, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; e = $f.e; p = $f.p; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		p = this;
		/* */ if (!(e === ptrType$1.nil)) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!(e === ptrType$1.nil)) { */ case 1:
			/* */ if (e.String() === "error") { $s = 3; continue; }
			/* */ if (e.LastReply) { $s = 4; continue; }
			/* */ $s = 5; continue;
			/* if (e.String() === "error") { */ case 3:
				$r = p.Reject(new sliceType$3([new mapType(e.Params)])); /* */ $s = 7; case 7: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				$s = 6; continue;
			/* } else if (e.LastReply) { */ case 4:
				$r = p.Resolve(new sliceType$3([new mapType(e.Params), UnwrapPayload(e.Payload)])); /* */ $s = 8; case 8: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				$s = 6; continue;
			/* } else { */ case 5:
				$r = p.Notify(new sliceType$3([new mapType(e.Params), UnwrapPayload(e.Payload)])); /* */ $s = 9; case 9: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* } */ case 6:
		/* } */ case 2:
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: Promise.ptr.prototype.OnReply }; } $f.$ptr = $ptr; $f.e = e; $f.p = p; $f.$s = $s; $f.$r = $r; return $f;
	};
	Promise.prototype.OnReply = function(e) { return this.$val.OnReply(e); };
	Promise.ptr.prototype.Resolve = function(args) {
		var $ptr, _i, _ref, args, callback, p, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _i = $f._i; _ref = $f._ref; args = $f.args; callback = $f.callback; p = $f.p; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		p = this;
		_ref = p.fulfillers;
		_i = 0;
		/* while (true) { */ case 1:
			/* if (!(_i < _ref.$length)) { break; } */ if(!(_i < _ref.$length)) { $s = 2; continue; }
			callback = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			$r = p.invoke("Promise onFulfilled callback:", callback, args); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			_i++;
		/* } */ $s = 1; continue; case 2:
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: Promise.ptr.prototype.Resolve }; } $f.$ptr = $ptr; $f._i = _i; $f._ref = _ref; $f.args = args; $f.callback = callback; $f.p = p; $f.$s = $s; $f.$r = $r; return $f;
	};
	Promise.prototype.Resolve = function(args) { return this.$val.Resolve(args); };
	Promise.ptr.prototype.Reject = function(args) {
		var $ptr, _i, _ref, args, callback, p, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _i = $f._i; _ref = $f._ref; args = $f.args; callback = $f.callback; p = $f.p; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		p = this;
		_ref = p.rejecters;
		_i = 0;
		/* while (true) { */ case 1:
			/* if (!(_i < _ref.$length)) { break; } */ if(!(_i < _ref.$length)) { $s = 2; continue; }
			callback = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			$r = p.invoke("Promise onRejected callback:", callback, args); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			_i++;
		/* } */ $s = 1; continue; case 2:
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: Promise.ptr.prototype.Reject }; } $f.$ptr = $ptr; $f._i = _i; $f._ref = _ref; $f.args = args; $f.callback = callback; $f.p = p; $f.$s = $s; $f.$r = $r; return $f;
	};
	Promise.prototype.Reject = function(args) { return this.$val.Reject(args); };
	Promise.ptr.prototype.Notify = function(args) {
		var $ptr, _i, _ref, args, callback, p, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _i = $f._i; _ref = $f._ref; args = $f.args; callback = $f.callback; p = $f.p; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		p = this;
		_ref = p.notifiers;
		_i = 0;
		/* while (true) { */ case 1:
			/* if (!(_i < _ref.$length)) { break; } */ if(!(_i < _ref.$length)) { $s = 2; continue; }
			callback = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			$r = p.invoke("Promise onNotified callback:", callback, args); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			_i++;
		/* } */ $s = 1; continue; case 2:
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: Promise.ptr.prototype.Notify }; } $f.$ptr = $ptr; $f._i = _i; $f._ref = _ref; $f.args = args; $f.callback = callback; $f.p = p; $f.$s = $s; $f.$r = $r; return $f;
	};
	Promise.prototype.Notify = function(args) { return this.$val.Notify(args); };
	Promise.ptr.prototype.invoke = function(logPrefix, callback, args) {
		var $ptr, args, callback, logPrefix, p, $s, $deferred, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; args = $f.args; callback = $f.callback; logPrefix = $f.logPrefix; p = $f.p; $s = $f.$s; $deferred = $f.$deferred; $r = $f.$r; } var $err = null; try { s: while (true) { switch ($s) { case 0: $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		logPrefix = [logPrefix];
		p = [p];
		p[0] = this;
		$deferred.push([(function(logPrefix, p) { return function $b() {
			var $ptr, $s, $r;
			/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
			$r = p[0].OnPanic(logPrefix[0], $recover()); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f.$s = $s; $f.$r = $r; return $f;
		}; })(logPrefix, p), []]);
		callback.apply(undefined, $externalize(args, sliceType$3));
		/* */ $s = -1; case -1: } return; } } catch(err) { $err = err; $s = -1; } finally { $callDeferred($deferred, $err); if($curGoroutine.asleep) { if ($f === undefined) { $f = { $blk: Promise.ptr.prototype.invoke }; } $f.$ptr = $ptr; $f.args = args; $f.callback = callback; $f.logPrefix = logPrefix; $f.p = p; $f.$s = $s; $f.$deferred = $deferred; $f.$r = $r; return $f; } }
	};
	Promise.prototype.invoke = function(logPrefix, callback, args) { return this.$val.invoke(logPrefix, callback, args); };
	NewSessionAdapter = function(session) {
		var $ptr, session;
		return new SessionAdapter.ptr(session, Panicer((function() {
			var $ptr;
			return (function $b(msg) {
				var $ptr, msg, $s, $r;
				/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; msg = $f.msg; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
				$r = session.OnLog(new sliceType$3([new $String(msg)])); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f.msg = msg; $f.$s = $s; $f.$r = $r; return $f;
			});
		})));
	};
	$pkg.NewSessionAdapter = NewSessionAdapter;
	SessionAdapter.ptr.prototype.InvokeOnSessionEvent = function(logPrefix, callback, e) {
		var $ptr, adapter, callback, e, logPrefix, $s, $deferred, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; adapter = $f.adapter; callback = $f.callback; e = $f.e; logPrefix = $f.logPrefix; $s = $f.$s; $deferred = $f.$deferred; $r = $f.$r; } var $err = null; try { s: while (true) { switch ($s) { case 0: $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		adapter = [adapter];
		logPrefix = [logPrefix];
		adapter[0] = this;
		$deferred.push([(function(adapter, logPrefix) { return function $b() {
			var $ptr, $s, $r;
			/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
			$r = adapter[0].OnPanic(logPrefix[0], $recover()); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f.$s = $s; $f.$r = $r; return $f;
		}; })(adapter, logPrefix), []]);
		callback($externalize(e.Params, mapType));
		/* */ $s = -1; case -1: } return; } } catch(err) { $err = err; $s = -1; } finally { $callDeferred($deferred, $err); if($curGoroutine.asleep) { if ($f === undefined) { $f = { $blk: SessionAdapter.ptr.prototype.InvokeOnSessionEvent }; } $f.$ptr = $ptr; $f.adapter = adapter; $f.callback = callback; $f.e = e; $f.logPrefix = logPrefix; $f.$s = $s; $f.$deferred = $deferred; $f.$r = $r; return $f; } }
	};
	SessionAdapter.prototype.InvokeOnSessionEvent = function(logPrefix, callback, e) { return this.$val.InvokeOnSessionEvent(logPrefix, callback, e); };
	SessionAdapter.ptr.prototype.OnSessionEvent = function(callback) {
		var $ptr, adapter, callback;
		adapter = this;
		adapter.Session.OnSessionEvent = (function $b(e) {
			var $ptr, e, $s, $r;
			/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; e = $f.e; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
			$r = adapter.InvokeOnSessionEvent("Session.onSessionEvent callback:", callback, e); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f.e = e; $f.$s = $s; $f.$r = $r; return $f;
		});
	};
	SessionAdapter.prototype.OnSessionEvent = function(callback) { return this.$val.OnSessionEvent(callback); };
	SessionAdapter.ptr.prototype.InvokeOnEvent = function(logPrefix, callback, e) {
		var $ptr, adapter, callback, e, logPrefix, $s, $deferred, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; adapter = $f.adapter; callback = $f.callback; e = $f.e; logPrefix = $f.logPrefix; $s = $f.$s; $deferred = $f.$deferred; $r = $f.$r; } var $err = null; try { s: while (true) { switch ($s) { case 0: $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		adapter = [adapter];
		logPrefix = [logPrefix];
		adapter[0] = this;
		$deferred.push([(function(adapter, logPrefix) { return function $b() {
			var $ptr, $s, $r;
			/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
			$r = adapter[0].OnPanic(logPrefix[0], $recover()); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f.$s = $s; $f.$r = $r; return $f;
		}; })(adapter, logPrefix), []]);
		callback($externalize(e.Params, mapType), $externalize(UnwrapPayload(e.Payload), sliceType));
		/* */ $s = -1; case -1: } return; } } catch(err) { $err = err; $s = -1; } finally { $callDeferred($deferred, $err); if($curGoroutine.asleep) { if ($f === undefined) { $f = { $blk: SessionAdapter.ptr.prototype.InvokeOnEvent }; } $f.$ptr = $ptr; $f.adapter = adapter; $f.callback = callback; $f.e = e; $f.logPrefix = logPrefix; $f.$s = $s; $f.$deferred = $deferred; $f.$r = $r; return $f; } }
	};
	SessionAdapter.prototype.InvokeOnEvent = function(logPrefix, callback, e) { return this.$val.InvokeOnEvent(logPrefix, callback, e); };
	SessionAdapter.ptr.prototype.OnEvent = function(callback) {
		var $ptr, adapter, callback;
		adapter = this;
		adapter.Session.OnEvent = (function $b(e) {
			var $ptr, e, $s, $r;
			/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; e = $f.e; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
			$r = adapter.InvokeOnEvent("Session.onEvent callback:", callback, e); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f.e = e; $f.$s = $s; $f.$r = $r; return $f;
		});
	};
	SessionAdapter.prototype.OnEvent = function(callback) { return this.$val.OnEvent(callback); };
	SessionAdapter.ptr.prototype.OnClose = function(callback) {
		var $ptr, adapter, callback;
		adapter = this;
		adapter.Session.OnClose = (function $b() {
			var $ptr, $s, $deferred, $r;
			/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; $s = $f.$s; $deferred = $f.$deferred; $r = $f.$r; } var $err = null; try { s: while (true) { switch ($s) { case 0: $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
			$deferred.push([(function $b() {
				var $ptr, $s, $r;
				/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
				$r = adapter.OnPanic("Session.onClose callback:", $recover()); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f.$s = $s; $f.$r = $r; return $f;
			}), []]);
			callback();
			/* */ $s = -1; case -1: } return; } } catch(err) { $err = err; $s = -1; } finally { $callDeferred($deferred, $err); if($curGoroutine.asleep) { if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f.$s = $s; $f.$deferred = $deferred; $f.$r = $r; return $f; } }
		});
	};
	SessionAdapter.prototype.OnClose = function(callback) { return this.$val.OnClose(callback); };
	SessionAdapter.ptr.prototype.OnConnState = function(callback) {
		var $ptr, adapter, callback;
		adapter = this;
		if (callback === null) {
			adapter.Session.OnConnState = $throwNilPointerError;
			return;
		}
		adapter.Session.OnConnState = (function $b(state) {
			var $ptr, state, $s, $deferred, $r;
			/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; state = $f.state; $s = $f.$s; $deferred = $f.$deferred; $r = $f.$r; } var $err = null; try { s: while (true) { switch ($s) { case 0: $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
			$deferred.push([(function $b() {
				var $ptr, $s, $r;
				/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
				$r = adapter.OnPanic("Session.onConnState callback:", $recover()); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f.$s = $s; $f.$r = $r; return $f;
			}), []]);
			callback($externalize(state, $String));
			/* */ $s = -1; case -1: } return; } } catch(err) { $err = err; $s = -1; } finally { $callDeferred($deferred, $err); if($curGoroutine.asleep) { if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f.state = state; $f.$s = $s; $f.$deferred = $deferred; $f.$r = $r; return $f; } }
		});
	};
	SessionAdapter.prototype.OnConnState = function(callback) { return this.$val.OnConnState(callback); };
	SessionAdapter.ptr.prototype.OnConnActive = function(callback) {
		var $ptr, adapter, callback;
		adapter = this;
		if (callback === null) {
			adapter.Session.OnConnActive = $throwNilPointerError;
			return;
		}
		adapter.Session.OnConnActive = (function $b() {
			var $ptr, $s, $deferred, $r;
			/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; $s = $f.$s; $deferred = $f.$deferred; $r = $f.$r; } var $err = null; try { s: while (true) { switch ($s) { case 0: $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
			$deferred.push([(function $b() {
				var $ptr, $s, $r;
				/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
				$r = adapter.OnPanic("Session.onConnActive callback:", $recover()); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f.$s = $s; $f.$r = $r; return $f;
			}), []]);
			callback(new ($global.Date)().getTime());
			/* */ $s = -1; case -1: } return; } } catch(err) { $err = err; $s = -1; } finally { $callDeferred($deferred, $err); if($curGoroutine.asleep) { if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f.$s = $s; $f.$deferred = $deferred; $f.$r = $r; return $f; } }
		});
	};
	SessionAdapter.prototype.OnConnActive = function(callback) { return this.$val.OnConnActive(callback); };
	SessionAdapter.ptr.prototype.OnLog = function(callback) {
		var $ptr, adapter, callback;
		adapter = this;
		if (callback === null) {
			adapter.Session.OnLog = $throwNilPointerError;
			return;
		}
		adapter.Session.OnLog = (function $b(tokens) {
			var $ptr, _i, _r, _ref, _ref$1, message, str, t, t$1, t$2, tokens, x, $s, $deferred, $r;
			/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _i = $f._i; _r = $f._r; _ref = $f._ref; _ref$1 = $f._ref$1; message = $f.message; str = $f.str; t = $f.t; t$1 = $f.t$1; t$2 = $f.t$2; tokens = $f.tokens; x = $f.x; $s = $f.$s; $deferred = $f.$deferred; $r = $f.$r; } var $err = null; try { s: while (true) { switch ($s) { case 0: $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
			$deferred.push([(function() {
				var $ptr;
				$recover();
			}), []]);
			message = "";
			_ref = tokens;
			_i = 0;
			/* while (true) { */ case 1:
				/* if (!(_i < _ref.$length)) { break; } */ if(!(_i < _ref.$length)) { $s = 2; continue; }
				x = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
				str = "";
				_ref$1 = x;
				/* */ if ($assertType(_ref$1, $String, true)[1]) { $s = 3; continue; }
				/* */ if ($assertType(_ref$1, $error, true)[1]) { $s = 4; continue; }
				/* */ $s = 5; continue;
				/* if ($assertType(_ref$1, $String, true)[1]) { */ case 3:
					t = _ref$1.$val;
					str = t;
					$s = 6; continue;
				/* } else if ($assertType(_ref$1, $error, true)[1]) { */ case 4:
					t$1 = _ref$1;
					_r = t$1.Error(); /* */ $s = 7; case 7: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
					str = _r;
					$s = 6; continue;
				/* } else { */ case 5:
					t$2 = _ref$1;
					str = $internalize($global.JSON.stringify($externalize(t$2, $emptyInterface)), $String);
				/* } */ case 6:
				if (message.length > 0) {
					message = message + (" ");
				}
				message = message + (str);
				_i++;
			/* } */ $s = 1; continue; case 2:
			while (true) {
				if (!(message.length > 0 && (message.charCodeAt((message.length - 1 >> 0)) === 32))) { break; }
				message = message.substring(0, (message.length - 1 >> 0));
			}
			callback($externalize(message, $String));
			/* */ $s = -1; case -1: } return; } } catch(err) { $err = err; $s = -1; } finally { $callDeferred($deferred, $err); if($curGoroutine.asleep) { if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f._i = _i; $f._r = _r; $f._ref = _ref; $f._ref$1 = _ref$1; $f.message = message; $f.str = str; $f.t = t; $f.t$1 = t$1; $f.t$2 = t$2; $f.tokens = tokens; $f.x = x; $f.$s = $s; $f.$deferred = $deferred; $f.$r = $r; return $f; } }
		});
	};
	SessionAdapter.prototype.OnLog = function(callback) { return this.$val.OnLog(callback); };
	SessionAdapter.ptr.prototype.SetAddress = function(value) {
		var $ptr, adapter, value;
		adapter = this;
		adapter.Session.Address = value;
	};
	SessionAdapter.prototype.SetAddress = function(value) { return this.$val.SetAddress(value); };
	SessionAdapter.ptr.prototype.Send = function(params, payload) {
		var $ptr, _entry, _tuple, action, adapter, disabled, p, params, payload, result;
		result = null;
		adapter = this;
		action = new ninchat.Action.ptr(params, WrapPayload(payload), $throwNilPointerError, new $Int64(0, 0));
		_tuple = (_entry = params[$String.keyFor("action_id")], _entry !== undefined ? [_entry.v, true] : [$ifaceNil, false]);
		disabled = _tuple[1];
		if (!disabled) {
			p = new Promise.ptr(adapter.OnPanic, sliceType.nil, sliceType.nil, sliceType.nil);
			action.OnReply = $methodVal(p, "OnReply");
			result = p.Object();
		}
		adapter.Session.Send(action);
		return result;
	};
	SessionAdapter.prototype.Send = function(params, payload) { return this.$val.Send(params, payload); };
	newSession = function() {
		var $ptr, adapter, session;
		session = new ninchat.Session.ptr($throwNilPointerError, $throwNilPointerError, $throwNilPointerError, $throwNilPointerError, $throwNilPointerError, $throwNilPointerError, "", false, false, $ifaceNil, "", new $Int64(0, 0), $chanNil, sliceType$4.nil, 0, false, new $Int64(0, 0), new $Int64(0, 0), $chanNil, false, false);
		adapter = NewSessionAdapter(session);
		return $makeMap($String.keyFor, [{ k: "onSessionEvent", v: new funcType$4($methodVal(adapter, "OnSessionEvent")) }, { k: "onEvent", v: new funcType$4($methodVal(adapter, "OnEvent")) }, { k: "onClose", v: new funcType$4($methodVal(adapter, "OnClose")) }, { k: "onConnState", v: new funcType$4($methodVal(adapter, "OnConnState")) }, { k: "onConnActive", v: new funcType$4($methodVal(adapter, "OnConnActive")) }, { k: "onLog", v: new funcType$4($methodVal(adapter, "OnLog")) }, { k: "setParams", v: new funcType$5($methodVal(session, "SetParams")) }, { k: "setTransport", v: new funcType$6($methodVal(session, "SetTransport")) }, { k: "setAddress", v: new funcType$6($methodVal(adapter, "SetAddress")) }, { k: "open", v: new funcType$7($methodVal(session, "Open")) }, { k: "close", v: new funcType$7($methodVal(session, "Close")) }, { k: "send", v: new funcType$8($methodVal(adapter, "Send")) }]);
	};
	ptrType$4.methods = [{prop: "Object", name: "Object", pkg: "", typ: $funcType([], [ptrType], false)}, {prop: "OnReply", name: "OnReply", pkg: "", typ: $funcType([ptrType$1], [], false)}, {prop: "Resolve", name: "Resolve", pkg: "", typ: $funcType([sliceType$3], [], true)}, {prop: "Reject", name: "Reject", pkg: "", typ: $funcType([sliceType$3], [], true)}, {prop: "Notify", name: "Notify", pkg: "", typ: $funcType([sliceType$3], [], true)}, {prop: "invoke", name: "invoke", pkg: "ninchatclient/lib", typ: $funcType([$String, ptrType, sliceType$3], [], true)}];
	ptrType$5.methods = [{prop: "InvokeOnSessionEvent", name: "InvokeOnSessionEvent", pkg: "", typ: $funcType([$String, ptrType, ptrType$1], [], false)}, {prop: "OnSessionEvent", name: "OnSessionEvent", pkg: "", typ: $funcType([ptrType], [], false)}, {prop: "InvokeOnEvent", name: "InvokeOnEvent", pkg: "", typ: $funcType([$String, ptrType, ptrType$1], [], false)}, {prop: "OnEvent", name: "OnEvent", pkg: "", typ: $funcType([ptrType], [], false)}, {prop: "OnClose", name: "OnClose", pkg: "", typ: $funcType([ptrType], [], false)}, {prop: "OnConnState", name: "OnConnState", pkg: "", typ: $funcType([ptrType], [], false)}, {prop: "OnConnActive", name: "OnConnActive", pkg: "", typ: $funcType([ptrType], [], false)}, {prop: "OnLog", name: "OnLog", pkg: "", typ: $funcType([ptrType], [], false)}, {prop: "SetAddress", name: "SetAddress", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Send", name: "Send", pkg: "", typ: $funcType([mapType, ptrType], [ptrType], false)}];
	Promise.init([{prop: "OnPanic", name: "OnPanic", pkg: "", typ: funcType$9, tag: ""}, {prop: "fulfillers", name: "fulfillers", pkg: "ninchatclient/lib", typ: sliceType, tag: ""}, {prop: "rejecters", name: "rejecters", pkg: "ninchatclient/lib", typ: sliceType, tag: ""}, {prop: "notifiers", name: "notifiers", pkg: "ninchatclient/lib", typ: sliceType, tag: ""}]);
	SessionAdapter.init([{prop: "Session", name: "Session", pkg: "", typ: ptrType$2, tag: ""}, {prop: "OnPanic", name: "OnPanic", pkg: "", typ: funcType$9, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = js.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = ninchat.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["ninchatmodel"] = (function() {
	var $pkg = {}, $init, js, ninchat, ninchatapi, ninchatmodel, clientlib, strings, ptrType, sliceType, funcType, funcType$1, sliceType$1, ptrType$1, sliceType$2, ptrType$2, ptrType$3, funcType$2, funcType$3, mapType, funcType$4, ptrType$4, funcType$5, ptrType$5, funcType$6, funcType$7, funcType$8, funcType$9, funcType$10, funcType$11, funcType$12, funcType$13, funcType$14, funcType$15, ptrType$6, funcType$16, funcType$17, jsMakeWrapper, main, invoke, newState, wrapMessageState, wrapUser, wrapDialogue;
	js = $packages["github.com/gopherjs/gopherjs/js"];
	ninchat = $packages["github.com/ninchat/ninchat-go"];
	ninchatapi = $packages["github.com/ninchat/ninchat-go/ninchatapi"];
	ninchatmodel = $packages["github.com/ninchat/ninchat-go/ninchatmodel"];
	clientlib = $packages["ninchatclient/lib"];
	strings = $packages["strings"];
	ptrType = $ptrType(js.Object);
	sliceType = $sliceType(ptrType);
	funcType = $funcType([sliceType], [ptrType], true);
	funcType$1 = $funcType([], [js.M], false);
	sliceType$1 = $sliceType($emptyInterface);
	ptrType$1 = $ptrType(ninchat.Action);
	sliceType$2 = $sliceType(ptrType$1);
	ptrType$2 = $ptrType(ninchatapi.UserAttrs);
	ptrType$3 = $ptrType(ninchat.Session);
	funcType$2 = $funcType([ptrType], [], false);
	funcType$3 = $funcType([], [ptrType], false);
	mapType = $mapType($String, $emptyInterface);
	funcType$4 = $funcType([$String], [ptrType], false);
	ptrType$4 = $ptrType(ninchatmodel.User);
	funcType$5 = $funcType([$String], [$emptyInterface], false);
	ptrType$5 = $ptrType(ninchatmodel.Dialogue);
	funcType$6 = $funcType([$String, $String], [$Bool], false);
	funcType$7 = $funcType([$String], [$Bool], false);
	funcType$8 = $funcType([], [], false);
	funcType$9 = $funcType([mapType], [], false);
	funcType$10 = $funcType([$String], [], false);
	funcType$11 = $funcType([mapType, ptrType], [ptrType], false);
	funcType$12 = $funcType([], [ptrType$2], false);
	funcType$13 = $funcType([$emptyInterface], [$emptyInterface], false);
	funcType$14 = $funcType([$emptyInterface, $emptyInterface], [], false);
	funcType$15 = $funcType([], [$String], false);
	ptrType$6 = $ptrType(ninchatapi.DialogueMemberAttrs);
	funcType$16 = $funcType([], [ptrType$6], false);
	funcType$17 = $funcType([], [mapType], false);
	jsMakeWrapper = function(i) {
		var $ptr, _r, i, i$1, m, methods, name, o, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; i = $f.i; i$1 = $f.i$1; m = $f.m; methods = $f.methods; name = $f.name; o = $f.o; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = [v];
		v[0] = i;
		o = new ($global.Object)();
		methods = v[0].constructor.methods;
		i$1 = 0;
		/* while (true) { */ case 1:
			/* if (!(i$1 < $parseInt(methods.length))) { break; } */ if(!(i$1 < $parseInt(methods.length))) { $s = 2; continue; }
			m = [m];
			m[0] = methods[i$1];
			/* */ if (!($internalize(m[0].pkg, $String) === "")) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (!($internalize(m[0].pkg, $String) === "")) { */ case 3:
				i$1 = i$1 + (1) >> 0;
				/* continue; */ $s = 1; continue;
			/* } */ case 4:
			name = $internalize(m[0].name, $String);
			_r = strings.ToLower(name.substring(0, 1)); /* */ $s = 5; case 5: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			o[$externalize(_r + name.substring(1), $String)] = $externalize((function(m, v) { return function(args) {
				var $ptr, args;
				return $externalizeFunction(v[0][$externalize($internalize(m[0].prop, $String), $String)], m[0].typ, $externalize(true, $Bool)).apply(v[0], $externalize(args, sliceType));
			}; })(m, v), funcType);
			i$1 = i$1 + (1) >> 0;
		/* } */ $s = 1; continue; case 2:
		return o;
		/* */ } return; } if ($f === undefined) { $f = { $blk: jsMakeWrapper }; } $f.$ptr = $ptr; $f._r = _r; $f.i = i; $f.i$1 = i$1; $f.m = m; $f.methods = methods; $f.name = name; $f.o = o; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	main = function() {
		var $ptr, module;
		module = new ($global.Object)();
		clientlib.Init(module);
		module.ADDED = 1;
		module.UPDATED = 2;
		module.REMOVED = 3;
		module.newState = $externalize(newState, funcType$1);
		$global.NinchatModel = module;
	};
	invoke = function(adapter, logPrefix, callback, args) {
		var $ptr, adapter, args, callback, logPrefix, $s, $deferred, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; adapter = $f.adapter; args = $f.args; callback = $f.callback; logPrefix = $f.logPrefix; $s = $f.$s; $deferred = $f.$deferred; $r = $f.$r; } var $err = null; try { s: while (true) { switch ($s) { case 0: $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		adapter = [adapter];
		logPrefix = [logPrefix];
		$deferred.push([(function(adapter, logPrefix) { return function $b() {
			var $ptr, $s, $r;
			/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
			$r = adapter[0].OnPanic(logPrefix[0], $recover()); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f.$s = $s; $f.$r = $r; return $f;
		}; })(adapter, logPrefix), []]);
		callback.apply(undefined, $externalize(args, sliceType$1));
		/* */ $s = -1; case -1: } return; } } catch(err) { $err = err; $s = -1; } finally { $callDeferred($deferred, $err); if($curGoroutine.asleep) { if ($f === undefined) { $f = { $blk: invoke }; } $f.$ptr = $ptr; $f.adapter = adapter; $f.args = args; $f.callback = callback; $f.logPrefix = logPrefix; $f.$s = $s; $f.$deferred = $deferred; $f.$r = $r; return $f; } }
	};
	newState = function() {
		var $ptr, adapter, state;
		state = new ninchatmodel.State.ptr(new ninchat.Session.ptr($throwNilPointerError, $throwNilPointerError, $throwNilPointerError, $throwNilPointerError, $throwNilPointerError, $throwNilPointerError, "", false, false, $ifaceNil, "", new $Int64(0, 0), $chanNil, sliceType$2.nil, 0, false, new $Int64(0, 0), new $Int64(0, 0), $chanNil, false, false), new ninchatmodel.SelfState.ptr(new ninchatmodel.User.ptr(new ninchatmodel.Aux.ptr(false), "", ptrType$2.nil), $throwNilPointerError, ptrType$3.nil), new ninchatmodel.SettingsState.ptr($throwNilPointerError, false, ptrType$3.nil), new ninchatmodel.UserState.ptr($throwNilPointerError, false, ptrType$3.nil), new ninchatmodel.DialogueState.ptr(new ninchatmodel.MessageState.ptr($throwNilPointerError, $throwNilPointerError, ptrType$3.nil, ""), $throwNilPointerError, false, ptrType$3.nil), $throwNilPointerError, $throwNilPointerError);
		adapter = clientlib.NewSessionAdapter(state.Session);
		return $makeMap($String.keyFor, [{ k: "Self", v: new js.M($makeMap($String.keyFor, [{ k: "onChange", v: new funcType$2((function(callback) {
			var $ptr, callback;
			state.Self.OnChange = (function $b(c, u, auth) {
				var $ptr, auth, c, u, $s, $r;
				/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; auth = $f.auth; c = $f.c; u = $f.u; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
				$r = invoke(adapter, "State.Self.onChange callback:", callback, new sliceType$1([new ninchatmodel.Change(c), new $jsObjectPtr(wrapUser(u)), new $String(auth)])); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f.auth = auth; $f.c = c; $f.u = u; $f.$s = $s; $f.$r = $r; return $f;
			});
		})) }, { k: "getUser", v: new funcType$3((function() {
			var $ptr;
			return wrapUser(state.Self.User);
		})) }])) }, { k: "Settings", v: new js.M($makeMap($String.keyFor, [{ k: "onChange", v: new funcType$2((function(callback) {
			var $ptr, callback;
			state.Settings.OnChange = (function $b(c, s) {
				var $ptr, c, s, $s, $r;
				/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; c = $f.c; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
				$r = invoke(adapter, "State.Settings.onChange callback:", callback, new sliceType$1([new ninchatmodel.Change(c), new mapType(s)])); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f.c = c; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
			});
		})) }, { k: "get", v: new funcType$1((function() {
			var $ptr;
			return state.Settings.Data;
		})) }])) }, { k: "Users", v: new js.M($makeMap($String.keyFor, [{ k: "onChange", v: new funcType$2((function(callback) {
			var $ptr, callback;
			state.Users.OnChange = (function $b(c, u) {
				var $ptr, c, u, $s, $r;
				/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; c = $f.c; u = $f.u; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
				$r = invoke(adapter, "State.Users.onChange callback:", callback, new sliceType$1([new ninchatmodel.Change(c), new $jsObjectPtr(wrapUser(u))])); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f.c = c; $f.u = u; $f.$s = $s; $f.$r = $r; return $f;
			});
		})) }, { k: "get", v: new funcType$4((function(id) {
			var $ptr, _entry, id;
			return wrapUser((_entry = state.Users.Map[$String.keyFor(id)], _entry !== undefined ? _entry.v : ptrType$4.nil));
		})) }])) }, { k: "Dialogues", v: new js.M($makeMap($String.keyFor, [{ k: "Messages", v: new js.M(wrapMessageState(adapter, state.Dialogues.Messages)) }, { k: "onChange", v: new funcType$2((function(callback) {
			var $ptr, callback;
			state.Dialogues.OnChange = (function $b(c, d) {
				var $ptr, _arg, _arg$1, _arg$2, _arg$3, _r, c, d, $s, $r;
				/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _arg = $f._arg; _arg$1 = $f._arg$1; _arg$2 = $f._arg$2; _arg$3 = $f._arg$3; _r = $f._r; c = $f.c; d = $f.d; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
				_arg = adapter;
				_arg$1 = callback;
				_arg$2 = new ninchatmodel.Change(c);
				_r = wrapDialogue(d); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				_arg$3 = new $jsObjectPtr(_r);
				$r = invoke(_arg, "State.Dialogues.onChange callback:", _arg$1, new sliceType$1([_arg$2, _arg$3])); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f._arg = _arg; $f._arg$1 = _arg$1; $f._arg$2 = _arg$2; $f._arg$3 = _arg$3; $f._r = _r; $f.c = c; $f.d = d; $f.$s = $s; $f.$r = $r; return $f;
			});
		})) }, { k: "get", v: new funcType$5((function $b(peerId) {
			var $ptr, _entry, _r, peerId, $s, $r;
			/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _entry = $f._entry; _r = $f._r; peerId = $f.peerId; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
			_r = wrapDialogue((_entry = state.Dialogues.Map[$String.keyFor(peerId)], _entry !== undefined ? _entry.v : ptrType$5.nil)); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			/* */ $s = 2; case 2:
			return new $jsObjectPtr(_r);
			/* */ } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f._entry = _entry; $f._r = _r; $f.peerId = peerId; $f.$s = $s; $f.$r = $r; return $f;
		})) }, { k: "loadEarlier", v: new funcType$4((function $b(peerId) {
			var $ptr, _r, loading, p, peerId, $s, $r;
			/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; loading = $f.loading; p = $f.p; peerId = $f.peerId; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
			loading = [loading];
			p = [p];
			peerId = [peerId];
			_r = state.Dialogues.LoadEarlier(peerId[0]); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			loading[0] = _r;
			p[0] = new clientlib.Promise.ptr(adapter.OnPanic, sliceType.nil, sliceType.nil, sliceType.nil);
			$go((function(loading, p, peerId) { return function $b() {
				var $ptr, _r$1, err, $s, $r;
				/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; err = $f.err; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
				_r$1 = $recv(loading[0]); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
				err = _r$1[0];
				/* */ if ($interfaceIsEqual(err, $ifaceNil)) { $s = 2; continue; }
				/* */ $s = 3; continue;
				/* if ($interfaceIsEqual(err, $ifaceNil)) { */ case 2:
					$r = p[0].Resolve(new sliceType$1([new $String(peerId[0])])); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					$s = 4; continue;
				/* } else { */ case 3:
					$r = p[0].Reject(new sliceType$1([new $String(peerId[0]), err])); /* */ $s = 6; case 6: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				/* } */ case 4:
				/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f.err = err; $f.$s = $s; $f.$r = $r; return $f;
			}; })(loading, p, peerId), []);
			return p[0].Object();
			/* */ } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f._r = _r; $f.loading = loading; $f.p = p; $f.peerId = peerId; $f.$s = $s; $f.$r = $r; return $f;
		})) }, { k: "updateStatus", v: new funcType$6((function $b(peerId, status) {
			var $ptr, _entry, _tuple, d, found, peerId, status, $s, $r;
			/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _entry = $f._entry; _tuple = $f._tuple; d = $f.d; found = $f.found; peerId = $f.peerId; status = $f.status; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
			found = false;
			_tuple = (_entry = state.Dialogues.Map[$String.keyFor(peerId)], _entry !== undefined ? [_entry.v, true] : [ptrType$5.nil, false]);
			d = _tuple[0];
			found = _tuple[1];
			/* */ if (found) { $s = 1; continue; }
			/* */ $s = 2; continue;
			/* if (found) { */ case 1:
				$r = state.Dialogues.UpdateStatus(d, status); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* } */ case 2:
			return found;
			/* */ } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f._entry = _entry; $f._tuple = _tuple; $f.d = d; $f.found = found; $f.peerId = peerId; $f.status = status; $f.$s = $s; $f.$r = $r; return $f;
		})) }, { k: "activate", v: new funcType$7((function $b(peerId) {
			var $ptr, _entry, _tuple, d, found, peerId, $s, $r;
			/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _entry = $f._entry; _tuple = $f._tuple; d = $f.d; found = $f.found; peerId = $f.peerId; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
			found = false;
			_tuple = (_entry = state.Dialogues.Map[$String.keyFor(peerId)], _entry !== undefined ? [_entry.v, true] : [ptrType$5.nil, false]);
			d = _tuple[0];
			found = _tuple[1];
			/* */ if (found) { $s = 1; continue; }
			/* */ $s = 2; continue;
			/* if (found) { */ case 1:
				$r = state.Dialogues.Activate(d); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* } */ case 2:
			return found;
			/* */ } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f._entry = _entry; $f._tuple = _tuple; $f.d = d; $f.found = found; $f.peerId = peerId; $f.$s = $s; $f.$r = $r; return $f;
		})) }, { k: "discard", v: new funcType$7((function $b(peerId) {
			var $ptr, _entry, _tuple, d, found, peerId, $s, $r;
			/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _entry = $f._entry; _tuple = $f._tuple; d = $f.d; found = $f.found; peerId = $f.peerId; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
			found = false;
			_tuple = (_entry = state.Dialogues.Map[$String.keyFor(peerId)], _entry !== undefined ? [_entry.v, true] : [ptrType$5.nil, false]);
			d = _tuple[0];
			found = _tuple[1];
			/* */ if (found) { $s = 1; continue; }
			/* */ $s = 2; continue;
			/* if (found) { */ case 1:
				$r = state.Dialogues.Discard(d); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* } */ case 2:
			return found;
			/* */ } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f._entry = _entry; $f._tuple = _tuple; $f.d = d; $f.found = found; $f.peerId = peerId; $f.$s = $s; $f.$r = $r; return $f;
		})) }])) }, { k: "onSessionEvent", v: new funcType$2((function(callback) {
			var $ptr, callback;
			state.OnSessionEvent = (function $b(e) {
				var $ptr, e, $s, $r;
				/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; e = $f.e; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
				$r = adapter.InvokeOnSessionEvent("State.onSessionEvent callback:", callback, e); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f.e = e; $f.$s = $s; $f.$r = $r; return $f;
			});
		})) }, { k: "onEvent", v: new funcType$2((function(callback) {
			var $ptr, callback;
			state.OnEvent = (function $b(e) {
				var $ptr, e, $s, $r;
				/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; e = $f.e; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
				$r = adapter.InvokeOnEvent("State.onEvent callback:", callback, e); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f.e = e; $f.$s = $s; $f.$r = $r; return $f;
			});
		})) }, { k: "onClose", v: new funcType$8(state.Session.OnClose) }, { k: "onConnState", v: new funcType$2($methodVal(adapter, "OnConnState")) }, { k: "onConnActive", v: new funcType$2($methodVal(adapter, "OnConnActive")) }, { k: "onLog", v: new funcType$2($methodVal(adapter, "OnLog")) }, { k: "setParams", v: new funcType$9($methodVal(state.Session, "SetParams")) }, { k: "setTransport", v: new funcType$10($methodVal(state.Session, "SetTransport")) }, { k: "setAddress", v: new funcType$10($methodVal(adapter, "SetAddress")) }, { k: "open", v: new funcType$3((function() {
			var $ptr, p;
			p = new clientlib.Promise.ptr(adapter.OnPanic, sliceType.nil, sliceType.nil, sliceType.nil);
			$go((function $b() {
				var $ptr, _r, err, $s, $r;
				/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; err = $f.err; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
				_r = state.Open(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				err = _r;
				/* */ if ($interfaceIsEqual(err, $ifaceNil)) { $s = 2; continue; }
				/* */ $s = 3; continue;
				/* if ($interfaceIsEqual(err, $ifaceNil)) { */ case 2:
					$r = p.Resolve(new sliceType$1([])); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					$s = 4; continue;
				/* } else { */ case 3:
					$r = p.Reject(new sliceType$1([err])); /* */ $s = 6; case 6: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				/* } */ case 4:
				/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f._r = _r; $f.err = err; $f.$s = $s; $f.$r = $r; return $f;
			}), []);
			return p.Object();
		})) }, { k: "close", v: new funcType$8($methodVal(state.Session, "Close")) }, { k: "send", v: new funcType$11($methodVal(adapter, "Send")) }]);
	};
	wrapMessageState = function(adapter, state) {
		var $ptr, adapter, state;
		return $makeMap($String.keyFor, [{ k: "onReceive", v: new funcType$2((function(callback) {
			var $ptr, callback;
			state.OnReceive = (function $b(targetId, e) {
				var $ptr, e, targetId, $s, $r;
				/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; e = $f.e; targetId = $f.targetId; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
				$r = invoke(adapter, "MessageState.onReceive callback:", callback, new sliceType$1([new $String(targetId), e])); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f.e = e; $f.targetId = targetId; $f.$s = $s; $f.$r = $r; return $f;
			});
		})) }, { k: "onUpdate", v: new funcType$2((function(callback) {
			var $ptr, callback;
			state.OnUpdate = (function $b(targetId, e) {
				var $ptr, e, targetId, $s, $r;
				/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; e = $f.e; targetId = $f.targetId; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
				$r = invoke(adapter, "MessageState.onUpdate callback:", callback, new sliceType$1([new $String(targetId), e])); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f.e = e; $f.targetId = targetId; $f.$s = $s; $f.$r = $r; return $f;
			});
		})) }]);
	};
	wrapUser = function(u) {
		var $ptr, o, u;
		o = null;
		if (!(u === ptrType$4.nil)) {
			o = new ($global.Object)();
			o.Id = $externalize(u.Id, $String);
			o.getAttrs = $externalize((function() {
				var $ptr;
				return u.Attrs;
			}), funcType$12);
			o.getAux = $externalize($methodVal(u.Aux, "GetAux"), funcType$13);
			o.setAux = $externalize($methodVal(u.Aux, "SetAux"), funcType$14);
		}
		return o;
	};
	wrapDialogue = function(d) {
		var $ptr, _r, d, o, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; d = $f.d; o = $f.o; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		d = [d];
		o = null;
		/* */ if (!(d[0] === ptrType$5.nil)) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!(d[0] === ptrType$5.nil)) { */ case 1:
			o = new ($global.Object)();
			o.PeerId = $externalize(d[0].PeerId, $String);
			_r = jsMakeWrapper(d[0].Window); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			o.Window = _r;
			o.getStatus = $externalize((function(d) { return function() {
				var $ptr;
				return d[0].Status;
			}; })(d), funcType$15);
			o.getSelfMemberAttrs = $externalize((function(d) { return function() {
				var $ptr;
				return d[0].SelfMemberAttrs;
			}; })(d), funcType$16);
			o.getPeerMemberAttrs = $externalize((function(d) { return function() {
				var $ptr;
				return d[0].PeerMemberAttrs;
			}; })(d), funcType$16);
			o.getAudienceMetadata = $externalize((function(d) { return function() {
				var $ptr;
				return d[0].AudienceMetadata;
			}; })(d), funcType$17);
		/* } */ case 2:
		return o;
		/* */ } return; } if ($f === undefined) { $f = { $blk: wrapDialogue }; } $f.$ptr = $ptr; $f._r = _r; $f.d = d; $f.o = o; $f.$s = $s; $f.$r = $r; return $f;
	};
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = js.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = ninchat.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = ninchatapi.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = ninchatmodel.$init(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = clientlib.$init(); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = strings.$init(); /* */ $s = 6; case 6: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		if ($pkg === $mainPkg) {
			main();
			$mainFinished = true;
		}
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$synthesizeMethods();
var $mainPkg = $packages["ninchatmodel"];
$packages["runtime"].$init();
$go($mainPkg.$init, [], true);
$flushConsole();

}).call(this);
//# sourceMappingURL=ninchatmodel.js.map
