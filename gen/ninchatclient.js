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
var $min = Math.min;
var $mod = function(x, y) { return x % y; };
var $parseInt = parseInt;
var $parseFloat = function(f) {
  if (f !== undefined && f !== null && f.constructor === Number) {
    return f;
  }
  return parseFloat(f);
};
var $flushConsole = function() {};
var $throwRuntimeError; /* set by package "runtime" */
var $throwNilPointerError = function() { $throwRuntimeError("invalid memory address or nil pointer dereference"); };
var $call = function(fn, rcvr, args) { return fn.apply(rcvr, args); };
var $makeFunc = function(fn) { return function() { return fn(new ($sliceType($jsObjectPtr))($global.Array.prototype.slice.call(arguments, []))); } };

var $froundBuf = new Float32Array(1);
var $fround = Math.fround || function(f) { $froundBuf[0] = f; return $froundBuf[0]; };

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

var $copy = function(dst, src, typ) {
  switch (typ.kind) {
  case $kindArray:
    $copyArray(dst, src, 0, 0, src.length, typ.elem);
    break;
  case $kindStruct:
    for (var i = 0; i < typ.fields.length; i++) {
      var f = typ.fields[i];
      switch (f.typ.kind) {
      case $kindArray:
      case $kindStruct:
        $copy(dst[f.prop], src[f.prop], f.typ);
        continue;
      default:
        dst[f.prop] = src[f.prop];
        continue;
      }
    }
    break;
  }
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
        $copy(dst[dstOffset + i], src[srcOffset + i], elem);
      }
      return;
    }
    for (var i = 0; i < n; i++) {
      $copy(dst[dstOffset + i], src[srcOffset + i], elem);
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
  $copy(clone, src, type);
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
      this.$set = function(v) { $copy(this, v, typ); };
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
    typ.ptr.prototype.$set = function(v) { $copy(this, v, typ); };
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
var $go = function(fun, args, direct) {
  $totalGoroutines++;
  $awakeGoroutines++;
  var $goroutine = function() {
    var rescheduled = false;
    try {
      $curGoroutine = $goroutine;
      var r = fun.apply(undefined, args);
      if (r && r.$blk !== undefined) {
        fun = function() { return r.$blk(); };
        args = [];
        rescheduled = true;
        return;
      }
      $goroutine.exit = true;
    } catch (err) {
      $goroutine.exit = true;
      throw err;
    } finally {
      $curGoroutine = $dummyGoroutine;
      if ($goroutine.exit && !rescheduled) { /* also set by runtime.Goexit() */
        $totalGoroutines--;
        $goroutine.asleep = true;
      }
      if ($goroutine.asleep && !rescheduled) {
        $awakeGoroutines--;
        if ($awakeGoroutines === 0 && $totalGoroutines !== 0 && $checkForDeadlock) {
          console.error("fatal error: all goroutines are asleep - deadlock!");
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
  $panic(new $String("cannot externalize " + t.string));
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
    $panic(new $String("cannot internalize js.Object, use *js.Object instead"));
  }
  var timePkg = $packages["time"];
  if (timePkg !== undefined && t === timePkg.Time) {
    if (!(v !== null && v !== undefined && v.constructor === Date)) {
      $panic(new $String("cannot internalize time.Time from " + typeof v + ", must be Date"));
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
      $panic(new $String("cannot internalize " + t.string));
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
        $panic(new $String("cannot internalize js.Object, use *js.Object instead"));
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
  $panic(new $String("cannot internalize " + t.string));
};

$packages["github.com/gopherjs/gopherjs/js"] = (function() {
	var $pkg = {}, $init, Object, Error, sliceType, ptrType, ptrType$1, init;
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
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		init();
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["runtime"] = (function() {
	var $pkg = {}, $init, js, TypeAssertionError, errorString, ptrType$5, init;
	js = $packages["github.com/gopherjs/gopherjs/js"];
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
	ptrType$5 = $ptrType(TypeAssertionError);
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
	ptrType$5.methods = [{prop: "RuntimeError", name: "RuntimeError", pkg: "", typ: $funcType([], [], false)}, {prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}];
	errorString.methods = [{prop: "RuntimeError", name: "RuntimeError", pkg: "", typ: $funcType([], [], false)}, {prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}];
	TypeAssertionError.init([{prop: "interfaceString", name: "interfaceString", pkg: "runtime", typ: $String, tag: ""}, {prop: "concreteString", name: "concreteString", pkg: "runtime", typ: $String, tag: ""}, {prop: "assertedString", name: "assertedString", pkg: "runtime", typ: $String, tag: ""}, {prop: "missingMethod", name: "missingMethod", pkg: "runtime", typ: $String, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = js.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
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
	var $pkg = {}, $init, Search;
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
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["github.com/ninchat/ninchat-go"] = (function() {
	var $pkg = {}, $init, errors, js, sort, Action, Event, Frame, backoff, Caller, httpHeader, httpRequest, httpResponse, Session, transport, duration, timer, webSocket, sliceType, sliceType$1, mapType, sliceType$2, ptrType, sliceType$3, ptrType$1, ptrType$2, sliceType$4, ptrType$3, funcType, ptrType$4, ptrType$5, structType, ptrType$6, sliceType$5, ptrType$7, ptrType$8, sliceType$6, funcType$1, funcType$2, ptrType$9, ptrType$10, ptrType$11, funcType$3, funcType$4, chanType, xhrType, xhrRequestHeaderSupport, sessionEventAckWindow, webSocketSupported, getAddress, getEndpointHosts, singleFrame, emptyData, dataLength, stringData, StringifyFrame, jsError, newJSONRequest, getJSONRequestResponseChannel, getResponseChannel, init, newGETRequest, newDataRequest, getResponseData, putResponseToChannel, jitterFloat64, jitterDuration, jitterInt64, jsonMarshal, jsonUnmarshalArray, jsonUnmarshalObject, jsonParse, longPollBinaryPayload, longPollTransport, longPollTransfer, longPollPing, longPollClose, logErrorResponse, randFloat64, newTimer, newWebSocket, webSocketTransport, webSocketHandshake, webSocketSend, webSocketReceive;
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
		var $ptr, _entry, _entry$1, _entry$2, _ref, _tuple, err, errorReason, errorType, event, found, sessionLost, x, x$1;
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
		_ref = errorType;
		if (_ref === "session_not_found") {
			sessionLost = true;
			if (!(errorReason === "")) {
				err = errors.New("error: " + errorType + " (" + errorReason + ")");
			} else {
				err = errors.New("error: " + errorType);
			}
		} else if (_ref === "connection_superseded" || _ref === "message_has_too_many_parts" || _ref === "message_part_too_long" || _ref === "message_too_long" || _ref === "request_malformed") {
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
		xhr = [xhr];
		$deferred.push([(function(c, xhr) { return function $b() {
			var $ptr, err, $s, $r;
			/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; err = $f.err; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
			err = jsError($recover());
			/* */ if (!($interfaceIsEqual(err, $ifaceNil))) { $s = 1; continue; }
			/* */ $s = 2; continue;
			/* if (!($interfaceIsEqual(err, $ifaceNil))) { */ case 1:
				$r = $send(c[0], new httpResponse.ptr(null, err)); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* } */ case 2:
			/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f.err = err; $f.$s = $s; $f.$r = $r; return $f;
		}; })(c, xhr), []]);
		xhr[0] = new (xhrType)();
		xhr[0].onload = $externalize((function(c, xhr) { return function() {
			var $ptr, response;
			response = xhr[0].responseText;
			$go((function(c, xhr) { return function $b() {
				var $ptr, $s, $r;
				/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
				$r = $send(c[0], new httpResponse.ptr(response, $ifaceNil)); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f.$s = $s; $f.$r = $r; return $f;
			}; })(c, xhr), []);
		}; })(c, xhr), funcType);
		xhr[0].onprogress = $externalize((function(c, xhr) { return function() {
			var $ptr;
		}; })(c, xhr), funcType);
		xhr[0].ontimeout = $externalize((function(c, xhr) { return function() {
			var $ptr;
			$go((function(c, xhr) { return function $b() {
				var $ptr, $s, $r;
				/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
				$r = $send(c[0], new httpResponse.ptr(null, errors.New("timeout"))); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f.$s = $s; $f.$r = $r; return $f;
			}; })(c, xhr), []);
		}; })(c, xhr), funcType);
		xhr[0].onerror = $externalize((function(c, xhr) { return function() {
			var $ptr;
			$go((function(c, xhr) { return function $b() {
				var $ptr, $s, $r;
				/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
				$r = $send(c[0], new httpResponse.ptr(null, errors.New("error"))); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f.$s = $s; $f.$r = $r; return $f;
			}; })(c, xhr), []);
		}; })(c, xhr), funcType);
		xhr[0].open($externalize(req.Method, $String), $externalize(req.URL, $String));
		xhr[0].timeout = $externalize(timeout, duration);
		if (xhrRequestHeaderSupport) {
			_ref = req.Header;
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
		xhr[0].send(req.data);
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
				$copy(response, _selection[1][0], httpResponse);
				/* */ if (!($interfaceIsEqual(response.err, $ifaceNil))) { $s = 23; continue; }
				/* */ $s = 24; continue;
				/* if (!($interfaceIsEqual(response.err, $ifaceNil))) { */ case 23:
					$r = s.log(new sliceType$1([new $String("poll error:"), response.err])); /* */ $s = 25; case 25: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				/* } */ case 24:
				poller = $chanNil;
				$r = s.connActive(); /* */ $s = 26; case 26: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				$s = 22; continue;
			/* } else if (_selection[0] === 1) { */ case 19:
				$copy(response, _selection[1][0], httpResponse);
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
		var $ptr, _ref, name, s;
		s = this;
		if (name === "") {
			s.forceLongPoll = false;
			return;
		}
		_ref = name;
		if (_ref === "websocket") {
			$panic(new $String("websocket transport cannot be forced"));
		} else if (_ref === "longpoll") {
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
		var $ptr, _entry, _entry$1, _entry$2, _entry$3, _entry$4, _entry$5, _entry$6, _entry$7, _i, _i$1, _key, _key$1, _key$2, _key$3, _key$4, _key$5, _key$6, _key$7, _key$8, _key$9, _keys, _keys$1, _ref, _ref$1, _ref$2, identityType, key, key$1, masterSign, params, s, userAuth, userId, value, value$1;
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
				_ref$2 = key$1;
				if (_ref$2 === "user_id" || _ref$2 === "user_auth" || _ref$2 === "identity_type" || _ref$2 === "identity_name" || _ref$2 === "identity_auth" || _ref$2 === "access_key" || _ref$2 === "master_sign") {
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
		var $ptr, _entry, _entry$1, _entry$2, _entry$3, _i, _key, _key$1, _key$2, _ref, _tuple, event, newValue, ok, param, params, quit, s, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _entry = $f._entry; _entry$1 = $f._entry$1; _entry$2 = $f._entry$2; _entry$3 = $f._entry$3; _i = $f._i; _key = $f._key; _key$1 = $f._key$1; _key$2 = $f._key$2; _ref = $f._ref; _tuple = $f._tuple; event = $f.event; newValue = $f.newValue; ok = $f.ok; param = $f.param; params = $f.params; quit = $f.quit; s = $f.s; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		ok = false;
		s = this;
		event = new Event.ptr(params, sliceType$2.nil, false);
		quit = false;
		if (event.String() === "error") {
			s.sessionId = $ifaceNil;
			s.running = false;
			quit = true;
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
		_tuple = event.Int64("event_id");
		s.receivedEventId = _tuple[0];
		s.ackedEventId = new $Int64(0, 0);
		$r = s.log(new sliceType$1([new $String("session created")])); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		ok = true;
		return ok;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Session.ptr.prototype.handleSessionEvent }; } $f.$ptr = $ptr; $f._entry = _entry; $f._entry$1 = _entry$1; $f._entry$2 = _entry$2; $f._entry$3 = _entry$3; $f._i = _i; $f._key = _key; $f._key$1 = _key$1; $f._key$2 = _key$2; $f._ref = _ref; $f._tuple = _tuple; $f.event = event; $f.newValue = newValue; $f.ok = ok; $f.param = param; $f.params = params; $f.quit = quit; $f.s = s; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
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
		_tuple$2 = event.getError();
		errorType = _tuple$2[0];
		errorReason = _tuple$2[1];
		sessionLost = _tuple$2[2];
		err = _tuple$2[3];
		/* */ if (!($interfaceIsEqual(err, $ifaceNil))) { $s = 11; continue; }
		/* */ $s = 12; continue;
		/* if (!($interfaceIsEqual(err, $ifaceNil))) { */ case 11:
			$r = s[0].log(new sliceType$1([new $String("event:"), err])); /* */ $s = 13; case 13: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* */ if (sessionLost) { $s = 14; continue; }
			/* */ $s = 15; continue;
			/* if (sessionLost) { */ case 14:
				s[0].sessionId = $ifaceNil;
				/* */ if (!s[0].canLogin()) { $s = 16; continue; }
				/* */ $s = 17; continue;
				/* if (!s[0].canLogin()) { */ case 16:
					s[0].running = false;
					$r = s[0].OnSessionEvent(event); /* */ $s = 18; case 18: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				/* } */ case 17:
			/* } */ case 15:
			return [actionId[0], sessionLost, needsAck, ok];
		/* } */ case 12:
		/* */ if (errorType === "deprecated") { $s = 19; continue; }
		/* */ $s = 20; continue;
		/* if (errorType === "deprecated") { */ case 19:
			$r = s[0].log(new sliceType$1([new $String("deprecated:"), new $String(errorReason)])); /* */ $s = 21; case 21: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 20:
		$r = s[0].OnEvent(event); /* */ $s = 22; case 22: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
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
		var $ptr, err, object, object$ptr, ws, x;
		object = false;
		err = $ifaceNil;
		ws = this;
		x = ws.receive();
		if (x === null) {
			return [object, err];
		}
		err = jsonUnmarshalObject(stringData(x), (object$ptr || (object$ptr = new ptrType$2(function() { return object; }, function($v) { object = $v; }))));
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
		xhrType = null;
		xhrRequestHeaderSupport = false;
		sessionEventAckWindow = jitterInt64(new $Int64(0, 4096), -0.25);
		webSocketSupported = !($global.WebSocket === undefined);
		init();
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
		o.catch = $externalize((function(onRejected) {
			var $ptr, onRejected;
			p.rejecters = $append(p.rejecters, onRejected);
			return o;
		}), funcType$2);
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
$packages["ninchatclient"] = (function() {
	var $pkg = {}, $init, js, ninchat, clientlib, main;
	js = $packages["github.com/gopherjs/gopherjs/js"];
	ninchat = $packages["github.com/ninchat/ninchat-go"];
	clientlib = $packages["ninchatclient/lib"];
	main = function() {
		var $ptr, module;
		module = new ($global.Object)();
		clientlib.Init(module);
		$global.NinchatClient = module;
	};
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = js.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = ninchat.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = clientlib.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		if ($pkg === $mainPkg) {
			main();
		}
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$synthesizeMethods();
var $mainPkg = $packages["ninchatclient"];
$packages["runtime"].$init();
$go($mainPkg.$init, [], true);
$flushConsole();

}).call(this);
//# sourceMappingURL=ninchatclient.js.map
