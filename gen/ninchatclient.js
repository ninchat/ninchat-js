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

var $methodExpr = function(method) {
  if (method.$expr === undefined) {
    method.$expr = function() {
      $stackDepthOffset--;
      try {
        return Function.call.apply(method, arguments);
      } finally {
        $stackDepthOffset++;
      }
    };
  }
  return method.$expr;
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
  $internalCopy(dst.$array, src.$array, dst.$offset, src.$offset, n, dst.constructor.elem);
  return n;
};

var $copy = function(dst, src, typ) {
  switch (typ.kind) {
  case $kindArray:
    $internalCopy(dst, src, 0, 0, src.length, typ.elem);
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

var $internalCopy = function(dst, src, dstOffset, srcOffset, n, elem) {
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
          set: function(value) { obj[fieldProp] = value; },
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

  $internalCopy(newArray, array, newOffset + slice.$length, offset, length, slice.constructor.elem);

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
  case $kindString:
  case $kindUnsafePointer:
    typ = function(v) { this.$val = v; };
    typ.prototype.$key = function() { return string + "$" + this.$val; };
    break;

  case $kindFloat32:
  case $kindFloat64:
    typ = function(v) { this.$val = v; };
    typ.prototype.$key = function() { return string + "$" + $floatKey(this.$val); };
    break;

  case $kindInt64:
    typ = function(high, low) {
      this.$high = (high + Math.floor(Math.ceil(low) / 4294967296)) >> 0;
      this.$low = low >>> 0;
      this.$val = this;
    };
    typ.prototype.$key = function() { return string + "$" + this.$high + "$" + this.$low; };
    break;

  case $kindUint64:
    typ = function(high, low) {
      this.$high = (high + Math.floor(Math.ceil(low) / 4294967296)) >>> 0;
      this.$low = low >>> 0;
      this.$val = this;
    };
    typ.prototype.$key = function() { return string + "$" + this.$high + "$" + this.$low; };
    break;

  case $kindComplex64:
    typ = function(real, imag) {
      this.$real = $fround(real);
      this.$imag = $fround(imag);
      this.$val = this;
    };
    typ.prototype.$key = function() { return string + "$" + this.$real + "$" + this.$imag; };
    break;

  case $kindComplex128:
    typ = function(real, imag) {
      this.$real = real;
      this.$imag = imag;
      this.$val = this;
    };
    typ.prototype.$key = function() { return string + "$" + this.$real + "$" + this.$imag; };
    break;

  case $kindArray:
    typ = function(v) { this.$val = v; };
    typ.ptr = $newType(4, $kindPtr, "*" + string, "", "", function(array) {
      this.$get = function() { return array; };
      this.$set = function(v) { $copy(this, v, typ); };
      this.$val = array;
    });
    typ.init = function(elem, len) {
      typ.elem = elem;
      typ.len = len;
      typ.comparable = elem.comparable;
      typ.prototype.$key = function() {
        return string + "$" + Array.prototype.join.call($mapArray(this.$val, function(e) {
          var key = e.$key ? e.$key() : String(e);
          return key.replace(/\\/g, "\\\\").replace(/\$/g, "\\$");
        }), "$");
      };
      typ.ptr.init(typ);
      Object.defineProperty(typ.ptr.nil, "nilCheck", { get: $throwNilPointerError });
    };
    break;

  case $kindChan:
    typ = function(capacity) {
      this.$val = this;
      this.$capacity = capacity;
      this.$buffer = [];
      this.$sendQueue = [];
      this.$recvQueue = [];
      this.$closed = false;
    };
    typ.prototype.$key = function() {
      if (this.$id === undefined) {
        $idCounter++;
        this.$id = $idCounter;
      }
      return String(this.$id);
    };
    typ.init = function(elem, sendOnly, recvOnly) {
      typ.elem = elem;
      typ.sendOnly = sendOnly;
      typ.recvOnly = recvOnly;
      typ.nil = new typ(0);
      typ.nil.$sendQueue = typ.nil.$recvQueue = { length: 0, push: function() {}, shift: function() { return undefined; }, indexOf: function() { return -1; } };
    };
    break;

  case $kindFunc:
    typ = function(v) { this.$val = v; };
    typ.init = function(params, results, variadic) {
      typ.params = params;
      typ.results = results;
      typ.variadic = variadic;
      typ.comparable = false;
    };
    break;

  case $kindInterface:
    typ = { implementedBy: {}, missingMethodFor: {} };
    typ.init = function(methods) {
      typ.methods = methods;
      methods.forEach(function(m) {
        $ifaceNil[m.prop] = $throwNilPointerError;
      });
    };
    break;

  case $kindMap:
    typ = function(v) { this.$val = v; };
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
    typ.prototype.$key = function() {
      if (this.$id === undefined) {
        $idCounter++;
        this.$id = $idCounter;
      }
      return String(this.$id);
    };
    typ.init = function(elem) {
      typ.elem = elem;
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
      typ.prototype.$key = function() {
        var val = this.$val;
        return string + "$" + $mapArray(fields, function(f) {
          var e = val[f.prop];
          var key = e.$key ? e.$key() : String(e);
          return key.replace(/\\/g, "\\\\").replace(/\$/g, "\\$");
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

  case $kindChan:
  case $kindPtr:
  case $kindSlice:
    typ.zero = function() { return typ.nil; };
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
  var string = "[" + len + "]" + elem.string;
  var typ = $arrayTypes[string];
  if (typ === undefined) {
    typ = $newType(12, $kindArray, string, "", "", null);
    $arrayTypes[string] = typ;
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

var $funcTypes = {};
var $funcType = function(params, results, variadic) {
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
  var typ = $funcTypes[string];
  if (typ === undefined) {
    typ = $newType(4, $kindFunc, string, "", "", null);
    $funcTypes[string] = typ;
    typ.init(params, results, variadic);
  }
  return typ;
};

var $interfaceTypes = {};
var $interfaceType = function(methods) {
  var string = "interface {}";
  if (methods.length !== 0) {
    string = "interface { " + $mapArray(methods, function(m) {
      return (m.pkg !== "" ? m.pkg + "." : "") + m.name + m.typ.string.substr(4);
    }).join("; ") + " }";
  }
  var typ = $interfaceTypes[string];
  if (typ === undefined) {
    typ = $newType(8, $kindInterface, string, "", "", null);
    $interfaceTypes[string] = typ;
    typ.init(methods);
  }
  return typ;
};
var $emptyInterface = $interfaceType([]);
var $ifaceNil = { $key: function() { return "nil"; } };
var $error = $newType(8, $kindInterface, "error", "error", "", null);
$error.init([{prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}]);

var $Map = function() {};
(function() {
  var names = Object.getOwnPropertyNames(Object.prototype);
  for (var i = 0; i < names.length; i++) {
    $Map.prototype[names[i]] = undefined;
  }
})();
var $mapTypes = {};
var $mapType = function(key, elem) {
  var string = "map[" + key.string + "]" + elem.string;
  var typ = $mapTypes[string];
  if (typ === undefined) {
    typ = $newType(4, $kindMap, string, "", "", null);
    $mapTypes[string] = typ;
    typ.init(key, elem);
  }
  return typ;
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
  var typ = elem.Slice;
  if (typ === undefined) {
    typ = $newType(12, $kindSlice, "[]" + elem.string, "", "", null);
    elem.Slice = typ;
    typ.init(elem);
  }
  return typ;
};
var $makeSlice = function(typ, length, capacity) {
  capacity = capacity || length;
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
  var string = "struct { " + $mapArray(fields, function(f) {
    return f.name + " " + f.typ.string + (f.tag !== "" ? (" \"" + f.tag.replace(/\\/g, "\\\\").replace(/"/g, "\\\"") + "\"") : "");
  }).join("; ") + " }";
  if (fields.length === 0) {
    string = "struct {}";
  }
  var typ = $structTypes[string];
  if (typ === undefined) {
    typ = $newType(0, $kindStruct, string, "", "", function() {
      this.$val = this;
      for (var i = 0; i < fields.length; i++) {
        var f = fields[i];
        var arg = arguments[i];
        this[f.prop] = arg !== undefined ? arg : f.typ.zero();
      }
    });
    $structTypes[string] = typ;
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
  var ninf = n.$real === 1/0 || n.$real === -1/0 || n.$imag === 1/0 || n.$imag === -1/0;
  var dinf = d.$real === 1/0 || d.$real === -1/0 || d.$imag === 1/0 || d.$imag === -1/0;
  var nnan = !ninf && (n.$real !== n.$real || n.$imag !== n.$imag);
  var dnan = !dinf && (d.$real !== d.$real || d.$imag !== d.$imag);
  if(nnan || dnan) {
    return new n.constructor(0/0, 0/0);
  }
  if (ninf && !dinf) {
    return new n.constructor(1/0, 1/0);
  }
  if (!ninf && dinf) {
    return new n.constructor(0, 0);
  }
  if (d.$real === 0 && d.$imag === 0) {
    if (n.$real === 0 && n.$imag === 0) {
      return new n.constructor(0/0, 0/0);
    }
    return new n.constructor(1/0, 1/0);
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

var $scheduled = [], $schedulerLoopActive = false;
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
  if (!$schedulerLoopActive) {
    $schedulerLoopActive = true;
    setTimeout(function() {
      while (true) {
        var r = $scheduled.shift();
        if (r === undefined) {
          $schedulerLoopActive = false;
          break;
        }
        r();
      };
    }, 0);
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
    },
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
    return [chan.constructor.elem.zero(), false];
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
    queuedRecv([chan.constructor.elem.zero(), false]);
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
      s += String.fromCharCode(r[0]);
    }
    return s;
  case $kindStruct:
    var timePkg = $packages["time"];
    if (timePkg && v.constructor === timePkg.Time.ptr) {
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
      var timePkg = $packages["time"];
      if (timePkg) {
        return new timePkg.Time(timePkg.Unix(new $Int64(0, 0), new $Int64(0, v.getTime() * 1000000)));
      }
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
    var m = new $Map();
    var keys = $keys(v);
    for (var i = 0; i < keys.length; i++) {
      var key = $internalize(keys[i], t.key);
      m[key.$key ? key.$key() : key] = { k: key, v: $internalize(v[keys[i]], t.elem) };
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
    for (var i = 0; i < v.length; i++) {
      s += $encodeRune(v.charCodeAt(i));
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
		_tmp = 0; _tmp$1 = n; i = _tmp; j = _tmp$1;
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
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: Search }; } $f.$ptr = $ptr; $f._q = _q; $f._r = _r; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f.f = f; $f.h = h; $f.i = i; $f.j = j; $f.n = n; $f.$s = $s; $f.$r = $r; return $f;
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
$packages["ninchatclient"] = (function() {
	var $pkg = {}, $init, errors, js, sort, Action, Backoff, Deferred, Transport, Session, Time, Duration, Timer, WebSocket, sliceType, mapType, sliceType$1, ptrType, funcType, ptrType$1, chanType, ptrType$2, funcType$1, funcType$2, funcType$3, ptrType$3, sliceType$2, funcType$4, chanType$1, ptrType$4, sliceType$3, funcType$5, mapType$1, funcType$6, funcType$7, ptrType$5, ptrType$6, sliceType$4, chanType$2, ptrType$7, ptrType$8, module, sessionEventAckWindow, xhrType, xhrRequestHeaderSupport, GetAddress, GetEndpointHosts, GetSessionEventCredentials, GetEventFrames, GetEventAndActionId, IsEventLastReply, GetEventError, Call, Jitter, JitterDuration, JitterUint64, jsError, jsInvoke, Atob, ParseDataURI, NewArray, NewArrayBuffer, NewUint8Array, NewObject, ParseJSON, StringifyJSON, Random, SetTimeout, ClearTimeout, Log, LongPollTransport, longPollTransfer, longPollPing, longPollClose, main, Defer, NewSession, Now, NewTimer, Sleep, NewWebSocket, StringifyFrame, WebSocketTransport, webSocketHandshake, webSocketSend, webSocketReceive, init, XHR, XHR_JSON;
	errors = $packages["errors"];
	js = $packages["github.com/gopherjs/gopherjs/js"];
	sort = $packages["sort"];
	Action = $pkg.Action = $newType(0, $kindStruct, "main.Action", "Action", "ninchatclient", function(Id_, Header_, Payload_, Deferred_, name_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Id = new $Uint64(0, 0);
			this.Header = null;
			this.Payload = null;
			this.Deferred = ptrType$3.nil;
			this.name = "";
			return;
		}
		this.Id = Id_;
		this.Header = Header_;
		this.Payload = Payload_;
		this.Deferred = Deferred_;
		this.name = name_;
	});
	Backoff = $pkg.Backoff = $newType(0, $kindStruct, "main.Backoff", "Backoff", "ninchatclient", function(lastSlot_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.lastSlot = 0;
			return;
		}
		this.lastSlot = lastSlot_;
	});
	Deferred = $pkg.Deferred = $newType(0, $kindStruct, "main.Deferred", "Deferred", "ninchatclient", function(resolve_, reject_, notify_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.resolve = sliceType$2.nil;
			this.reject = sliceType$2.nil;
			this.notify = sliceType$2.nil;
			return;
		}
		this.resolve = resolve_;
		this.reject = reject_;
		this.notify = notify_;
	});
	Transport = $pkg.Transport = $newType(4, $kindFunc, "main.Transport", "Transport", "ninchatclient", null);
	Session = $pkg.Session = $newType(0, $kindStruct, "main.Session", "Session", "ninchatclient", function(onSessionEvent_, onEvent_, onConnState_, onConnActive_, onLog_, address_, forceLongPoll_, sessionParams_, sessionId_, latestConnState_, latestConnActive_, lastActionId_, sendNotify_, sendBuffer_, numSent_, sendEventAck_, receivedEventId_, ackedEventId_, closeNotify_, closed_, stopped_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.onSessionEvent = null;
			this.onEvent = null;
			this.onConnState = null;
			this.onConnActive = null;
			this.onLog = null;
			this.address = "";
			this.forceLongPoll = false;
			this.sessionParams = false;
			this.sessionId = null;
			this.latestConnState = "";
			this.latestConnActive = new Time(0, 0);
			this.lastActionId = new $Uint64(0, 0);
			this.sendNotify = chanType$1.nil;
			this.sendBuffer = sliceType$3.nil;
			this.numSent = 0;
			this.sendEventAck = false;
			this.receivedEventId = new $Uint64(0, 0);
			this.ackedEventId = new $Uint64(0, 0);
			this.closeNotify = chanType$1.nil;
			this.closed = false;
			this.stopped = false;
			return;
		}
		this.onSessionEvent = onSessionEvent_;
		this.onEvent = onEvent_;
		this.onConnState = onConnState_;
		this.onConnActive = onConnActive_;
		this.onLog = onLog_;
		this.address = address_;
		this.forceLongPoll = forceLongPoll_;
		this.sessionParams = sessionParams_;
		this.sessionId = sessionId_;
		this.latestConnState = latestConnState_;
		this.latestConnActive = latestConnActive_;
		this.lastActionId = lastActionId_;
		this.sendNotify = sendNotify_;
		this.sendBuffer = sendBuffer_;
		this.numSent = numSent_;
		this.sendEventAck = sendEventAck_;
		this.receivedEventId = receivedEventId_;
		this.ackedEventId = ackedEventId_;
		this.closeNotify = closeNotify_;
		this.closed = closed_;
		this.stopped = stopped_;
	});
	Time = $pkg.Time = $newType(8, $kindInt64, "main.Time", "Time", "ninchatclient", null);
	Duration = $pkg.Duration = $newType(8, $kindInt64, "main.Duration", "Duration", "ninchatclient", null);
	Timer = $pkg.Timer = $newType(0, $kindStruct, "main.Timer", "Timer", "ninchatclient", function(C_, id_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.C = chanType$1.nil;
			this.id = null;
			return;
		}
		this.C = C_;
		this.id = id_;
	});
	WebSocket = $pkg.WebSocket = $newType(0, $kindStruct, "main.WebSocket", "WebSocket", "ninchatclient", function(Notify_, GoingAway_, impl_, open_, error_, buffer_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Notify = chanType$1.nil;
			this.GoingAway = false;
			this.impl = null;
			this.open = false;
			this.error = $ifaceNil;
			this.buffer = sliceType$2.nil;
			return;
		}
		this.Notify = Notify_;
		this.GoingAway = GoingAway_;
		this.impl = impl_;
		this.open = open_;
		this.error = error_;
		this.buffer = buffer_;
	});
	sliceType = $sliceType($String);
	mapType = $mapType($String, $emptyInterface);
	sliceType$1 = $sliceType($emptyInterface);
	ptrType = $ptrType(js.Error);
	funcType = $funcType([], [], false);
	ptrType$1 = $ptrType($Bool);
	chanType = $chanType($String, false, true);
	ptrType$2 = $ptrType(js.Object);
	funcType$1 = $funcType([ptrType$2, ptrType$2, ptrType$2], [$emptyInterface], false);
	funcType$2 = $funcType([], [mapType], false);
	funcType$3 = $funcType([ptrType$2], [$String], false);
	ptrType$3 = $ptrType(Deferred);
	sliceType$2 = $sliceType(ptrType$2);
	funcType$4 = $funcType([ptrType$2, ptrType$2, ptrType$2], [], false);
	chanType$1 = $chanType($Bool, false, false);
	ptrType$4 = $ptrType(Action);
	sliceType$3 = $sliceType(ptrType$4);
	funcType$5 = $funcType([ptrType$2], [], false);
	mapType$1 = $mapType($String, ptrType$2);
	funcType$6 = $funcType([mapType$1], [], false);
	funcType$7 = $funcType([ptrType$2, ptrType$2], [$emptyInterface], false);
	ptrType$5 = $ptrType(Timer);
	ptrType$6 = $ptrType(WebSocket);
	sliceType$4 = $sliceType($Uint8);
	chanType$2 = $chanType($String, false, false);
	ptrType$7 = $ptrType(Backoff);
	ptrType$8 = $ptrType(Session);
	Action.ptr.prototype.Name = function() {
		var $ptr, a;
		a = this;
		if (a.name === "") {
			a.name = $internalize(a.Header.action, $String);
		}
		return a.name;
	};
	Action.prototype.Name = function() { return this.$val.Name(); };
	GetAddress = function(address) {
		var $ptr, address;
		if (address === undefined || address === null) {
			return "api.ninchat.com";
		} else {
			return $internalize(address, $String);
		}
	};
	$pkg.GetAddress = GetAddress;
	GetEndpointHosts = function(response) {
		var $ptr, _tuple, endpoint, err, hosts, i, jsHosts, response, $deferred;
		/* */ var $err = null; try { $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		hosts = sliceType.nil;
		err = $ifaceNil;
		$deferred.push([(function() {
			var $ptr, e;
			e = jsError($recover());
			if (!($interfaceIsEqual(e, $ifaceNil))) {
				err = e;
			}
		}), []]);
		_tuple = ParseJSON(response); endpoint = _tuple[0]; err = _tuple[1];
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			return [hosts, err];
		}
		jsHosts = endpoint.hosts;
		if ($parseInt(jsHosts.length) === 0) {
			err = errors.New("endpoint hosts array is empty");
			return [hosts, err];
		}
		hosts = $makeSlice(sliceType, $parseInt(jsHosts.length));
		i = 0;
		while (true) {
			if (!(i < $parseInt(jsHosts.length))) { break; }
			((i < 0 || i >= hosts.$length) ? $throwRuntimeError("index out of range") : hosts.$array[hosts.$offset + i] = $internalize(jsHosts[i], $String));
			i = i + (1) >> 0;
		}
		return [hosts, err];
		/* */ } catch(err) { $err = err; } finally { $callDeferred($deferred, $err); if (!$curGoroutine.asleep) { return  [hosts, err]; } }
	};
	$pkg.GetEndpointHosts = GetEndpointHosts;
	GetSessionEventCredentials = function(header) {
		var $ptr, err, eventId, header, object, ok, sessionId, userAuth, userId, $deferred;
		/* */ var $err = null; try { $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		userId = null;
		userAuth = null;
		sessionId = null;
		eventId = new $Uint64(0, 0);
		ok = false;
		err = $ifaceNil;
		$deferred.push([(function() {
			var $ptr, e;
			e = jsError($recover());
			if (!($interfaceIsEqual(e, $ifaceNil))) {
				err = e;
			}
		}), []]);
		if (!($internalize(header.event, $String) === "session_created")) {
			return [userId, userAuth, sessionId, eventId, ok, err];
		}
		userId = header.user_id;
		object = header.user_auth;
		if (!(object === undefined)) {
			userAuth = object;
		}
		sessionId = header.session_id;
		eventId = $internalize(header.event_id, $Uint64);
		ok = true;
		return [userId, userAuth, sessionId, eventId, ok, err];
		/* */ } catch(err) { $err = err; } finally { $callDeferred($deferred, $err); if (!$curGoroutine.asleep) { return  [userId, userAuth, sessionId, eventId, ok, err]; } }
	};
	$pkg.GetSessionEventCredentials = GetSessionEventCredentials;
	GetEventFrames = function(header) {
		var $ptr, err, frames, header, object, $deferred;
		/* */ var $err = null; try { $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		frames = 0;
		err = $ifaceNil;
		$deferred.push([(function() {
			var $ptr;
			err = jsError($recover());
		}), []]);
		object = header.frames;
		if (!(object === undefined)) {
			frames = $parseInt(object) >> 0;
			if (frames < 0) {
				frames = 0;
			}
		}
		return [frames, err];
		/* */ } catch(err) { $err = err; } finally { $callDeferred($deferred, $err); if (!$curGoroutine.asleep) { return  [frames, err]; } }
	};
	$pkg.GetEventFrames = GetEventFrames;
	GetEventAndActionId = function(header) {
		var $ptr, actionId, err, eventId, header, object, object$1, $deferred;
		/* */ var $err = null; try { $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		eventId = new $Uint64(0, 0);
		actionId = new $Uint64(0, 0);
		err = $ifaceNil;
		$deferred.push([(function() {
			var $ptr;
			err = jsError($recover());
		}), []]);
		object = header.event_id;
		if (!(object === undefined)) {
			eventId = $internalize(object, $Uint64);
		}
		object$1 = header.action_id;
		if (!(object$1 === undefined)) {
			actionId = $internalize(object$1, $Uint64);
		}
		return [eventId, actionId, err];
		/* */ } catch(err) { $err = err; } finally { $callDeferred($deferred, $err); if (!$curGoroutine.asleep) { return  [eventId, actionId, err]; } }
	};
	$pkg.GetEventAndActionId = GetEventAndActionId;
	IsEventLastReply = function(header, action) {
		var $ptr, action, channels, err, header, historyLength, lastReply, users, $deferred;
		/* */ var $err = null; try { $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		lastReply = false;
		err = $ifaceNil;
		$deferred.push([(function() {
			var $ptr;
			err = jsError($recover());
		}), []]);
		lastReply = true;
		historyLength = header.history_length;
		if (!(historyLength === undefined)) {
			if (($parseInt(historyLength) >> 0) > 0) {
				lastReply = false;
			}
		}
		if (action.Name() === "search") {
			users = header.users;
			channels = header.channels;
			if (!(users === undefined) || !(channels === undefined)) {
				lastReply = false;
			}
		}
		return [lastReply, err];
		/* */ } catch(err) { $err = err; } finally { $callDeferred($deferred, $err); if (!$curGoroutine.asleep) { return  [lastReply, err]; } }
	};
	$pkg.IsEventLastReply = IsEventLastReply;
	GetEventError = function(header) {
		var $ptr, _ref, err, errorReason, errorType, header, object, sessionLost, $deferred;
		/* */ var $err = null; try { $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		errorType = "";
		errorReason = "";
		sessionLost = false;
		err = $ifaceNil;
		$deferred.push([(function() {
			var $ptr, e;
			e = jsError($recover());
			if (!($interfaceIsEqual(e, $ifaceNil))) {
				err = e;
			}
		}), []]);
		if (!($internalize(header.event, $String) === "error")) {
			return [errorType, errorReason, sessionLost, err];
		}
		errorType = $internalize(header.error_type, $String);
		object = header.error_reason;
		if (!(object === undefined)) {
			errorReason = $internalize(object, $String);
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
		/* */ } catch(err) { $err = err; } finally { $callDeferred($deferred, $err); if (!$curGoroutine.asleep) { return  [errorType, errorReason, sessionLost, err]; } }
	};
	$pkg.GetEventError = GetEventError;
	Backoff.ptr.prototype.Success = function() {
		var $ptr, b;
		b = this;
		b.lastSlot = 0;
	};
	Backoff.prototype.Success = function() { return this.$val.Success(); };
	Backoff.ptr.prototype.Failure = function(maxDelay) {
		var $ptr, b, delay, maxDelay;
		delay = new Duration(0, 0);
		b = this;
		if (b.lastSlot > 0) {
			delay = new Duration(0, Jitter($flatten64(maxDelay) * b.lastSlot / 1024, -0.5));
		}
		if (b.lastSlot < 1023) {
			b.lastSlot = ((((b.lastSlot + 1 >> 0)) << 1 >> 0)) - 1 >> 0;
		}
		return delay;
	};
	Backoff.prototype.Failure = function(maxDelay) { return this.$val.Failure(maxDelay); };
	Call = function(header, onLog, address) {
		var $ptr, _tuple, address, deferred, header, onLog, promise, url;
		promise = $ifaceNil;
		url = "https://" + GetAddress(address) + "/v2/call";
		_tuple = Defer(); deferred = _tuple[0]; promise = new mapType(_tuple[1]);
		$go((function $b() {
			var $ptr, _r, _tuple$1, _tuple$2, _tuple$3, channel, err, event, events, ok, response, $s, $r;
			/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tuple$1 = $f._tuple$1; _tuple$2 = $f._tuple$2; _tuple$3 = $f._tuple$3; channel = $f.channel; err = $f.err; event = $f.event; events = $f.events; ok = $f.ok; response = $f.response; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
			_tuple$1 = XHR_JSON(url, new $jsObjectPtr(header), JitterDuration(new Duration(0, 11000), 0.1)); channel = _tuple$1[0]; err = _tuple$1[1];
			/* */ if (!($interfaceIsEqual(err, $ifaceNil))) { $s = 1; continue; }
			/* */ $s = 2; continue;
			/* if (!($interfaceIsEqual(err, $ifaceNil))) { */ case 1:
				$r = Log("NinchatClient.call onLog callback", onLog, new sliceType$1([new $String("call:"), err])); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				$r = deferred.Reject(new sliceType$1([])); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				return;
			/* } */ case 2:
			_r = $recv(channel); /* */ $s = 5; case 5: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			_tuple$2 = _r; response = _tuple$2[0]; ok = _tuple$2[1];
			/* */ if (response === "") { $s = 6; continue; }
			/* */ $s = 7; continue;
			/* if (response === "") { */ case 6:
				/* */ if (ok) { $s = 8; continue; }
				/* */ $s = 9; continue;
				/* if (ok) { */ case 8:
					$r = Log("NinchatClient.call onLog callback", onLog, new sliceType$1([new $String("call error")])); /* */ $s = 11; case 11: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					$s = 10; continue;
				/* } else { */ case 9:
					$r = Log("NinchatClient.call onLog callback", onLog, new sliceType$1([new $String("call timeout")])); /* */ $s = 12; case 12: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				/* } */ case 10:
				$r = deferred.Reject(new sliceType$1([])); /* */ $s = 13; case 13: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				return;
			/* } */ case 7:
			_tuple$3 = ParseJSON(response); event = _tuple$3[0]; err = _tuple$3[1];
			/* */ if (!($interfaceIsEqual(err, $ifaceNil))) { $s = 14; continue; }
			/* */ $s = 15; continue;
			/* if (!($interfaceIsEqual(err, $ifaceNil))) { */ case 14:
				$r = Log("NinchatClient.call onLog callback", onLog, new sliceType$1([new $String("call response:"), err])); /* */ $s = 16; case 16: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				$r = deferred.Reject(new sliceType$1([])); /* */ $s = 17; case 17: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				return;
			/* } */ case 15:
			events = NewArray();
			events.push(event);
			$r = deferred.Resolve(new sliceType$1([new $jsObjectPtr(events)])); /* */ $s = 18; case 18: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f._r = _r; $f._tuple$1 = _tuple$1; $f._tuple$2 = _tuple$2; $f._tuple$3 = _tuple$3; $f.channel = channel; $f.err = err; $f.event = event; $f.events = events; $f.ok = ok; $f.response = response; $f.$s = $s; $f.$r = $r; return $f;
		}), []);
		return promise;
	};
	$pkg.Call = Call;
	Jitter = function(x, scale) {
		var $ptr, scale, x;
		return x + x * scale * Random();
	};
	$pkg.Jitter = Jitter;
	JitterDuration = function(d, scale) {
		var $ptr, d, scale;
		return new Duration(0, Jitter($flatten64(d), scale));
	};
	$pkg.JitterDuration = JitterDuration;
	JitterUint64 = function(n, scale) {
		var $ptr, n, scale;
		return new $Uint64(0, Jitter($flatten64(n), scale));
	};
	$pkg.JitterUint64 = JitterUint64;
	jsError = function(x) {
		var $ptr, _tuple, err, jsErr, msg, ok, x;
		err = $ifaceNil;
		if ($interfaceIsEqual(x, $ifaceNil)) {
			return err;
		}
		_tuple = $assertType(x, ptrType, true); jsErr = _tuple[0]; ok = _tuple[1];
		if (ok) {
			msg = $internalize(jsErr.Object.message, $String);
			if (msg === "") {
				msg = "error";
			}
			err = errors.New(msg);
			return err;
		}
		err = $assertType(x, $error);
		return err;
	};
	jsInvoke = function(name, function$1, args) {
		var $ptr, args, function$1, name, ok, $s, $deferred, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; args = $f.args; function$1 = $f.function$1; name = $f.name; ok = $f.ok; $s = $f.$s; $deferred = $f.$deferred; $r = $f.$r; } var $err = null; try { s: while (true) { switch ($s) { case 0: $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		name = [name];
		ok = false;
		$deferred.push([(function(name) { return function $b() {
			var $ptr, _r, err, $s, $r;
			/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; err = $f.err; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
			err = jsError($recover());
			/* */ if (!($interfaceIsEqual(err, $ifaceNil))) { $s = 1; continue; }
			/* */ $s = 2; continue;
			/* if (!($interfaceIsEqual(err, $ifaceNil))) { */ case 1:
				_r = err.Error(); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				console.log(name[0] + " invocation error: " + _r);
			/* } */ case 2:
			/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f._r = _r; $f.err = err; $f.$s = $s; $f.$r = $r; return $f;
		}; })(name), []]);
		function$1.apply(undefined, $externalize(args, sliceType$1));
		ok = true;
		return ok;
		/* */ $s = -1; case -1: } return; } } catch(err) { $err = err; $s = -1; } finally { $callDeferred($deferred, $err); if (!$curGoroutine.asleep) { return  ok; } if($curGoroutine.asleep) { if ($f === undefined) { $f = { $blk: jsInvoke }; } $f.$ptr = $ptr; $f.args = args; $f.function$1 = function$1; $f.name = name; $f.ok = ok; $f.$s = $s; $f.$deferred = $deferred; $f.$r = $r; return $f; } }
	};
	Atob = function(string) {
		var $ptr, binary, err, string, $deferred;
		/* */ var $err = null; try { $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		binary = null;
		err = $ifaceNil;
		$deferred.push([(function() {
			var $ptr;
			err = jsError($recover());
		}), []]);
		binary = $global.atob(string);
		return [binary, err];
		/* */ } catch(err) { $err = err; } finally { $callDeferred($deferred, $err); if (!$curGoroutine.asleep) { return  [binary, err]; } }
	};
	$pkg.Atob = Atob;
	ParseDataURI = function(string) {
		var $ptr, base64, err, string, $deferred;
		/* */ var $err = null; try { $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		base64 = null;
		err = $ifaceNil;
		$deferred.push([(function() {
			var $ptr;
			err = jsError($recover());
		}), []]);
		base64 = string.split($externalize(",", $String))[1];
		return [base64, err];
		/* */ } catch(err) { $err = err; } finally { $callDeferred($deferred, $err); if (!$curGoroutine.asleep) { return  [base64, err]; } }
	};
	$pkg.ParseDataURI = ParseDataURI;
	NewArray = function() {
		var $ptr;
		return new ($global.Array)();
	};
	$pkg.NewArray = NewArray;
	NewArrayBuffer = function(length) {
		var $ptr, length;
		return new ($global.ArrayBuffer)(length);
	};
	$pkg.NewArrayBuffer = NewArrayBuffer;
	NewUint8Array = function(arrayBuffer) {
		var $ptr, arrayBuffer;
		return new ($global.Uint8Array)(arrayBuffer);
	};
	$pkg.NewUint8Array = NewUint8Array;
	NewObject = function() {
		var $ptr;
		return new ($global.Object)();
	};
	$pkg.NewObject = NewObject;
	ParseJSON = function(json) {
		var $ptr, err, json, object, $deferred;
		/* */ var $err = null; try { $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		object = null;
		err = $ifaceNil;
		$deferred.push([(function() {
			var $ptr;
			err = jsError($recover());
		}), []]);
		object = $global.JSON.parse($externalize(json, $String));
		return [object, err];
		/* */ } catch(err) { $err = err; } finally { $callDeferred($deferred, $err); if (!$curGoroutine.asleep) { return  [object, err]; } }
	};
	$pkg.ParseJSON = ParseJSON;
	StringifyJSON = function(object) {
		var $ptr, err, json, object, $deferred;
		/* */ var $err = null; try { $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		json = "";
		err = $ifaceNil;
		$deferred.push([(function() {
			var $ptr;
			err = jsError($recover());
		}), []]);
		json = $internalize($global.JSON.stringify($externalize(object, $emptyInterface)), $String);
		return [json, err];
		/* */ } catch(err) { $err = err; } finally { $callDeferred($deferred, $err); if (!$curGoroutine.asleep) { return  [json, err]; } }
	};
	$pkg.StringifyJSON = StringifyJSON;
	Random = function() {
		var $ptr;
		return $parseFloat($global.Math.random());
	};
	$pkg.Random = Random;
	SetTimeout = function(callback, timeout) {
		var $ptr, callback, id, timeout;
		id = null;
		id = $global.setTimeout($externalize(callback, funcType), $externalize(timeout, Duration));
		return id;
	};
	$pkg.SetTimeout = SetTimeout;
	ClearTimeout = function(id) {
		var $ptr, id;
		$global.clearTimeout(id);
	};
	$pkg.ClearTimeout = ClearTimeout;
	Log = function(logInvocationName, onLog, tokens) {
		var $ptr, _i, _r, _r$1, _ref, _tuple, _tuple$1, logInvocationName, message, ok, ok$1, onLog, str, tokens, x, y, y$1, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _i = $f._i; _r = $f._r; _r$1 = $f._r$1; _ref = $f._ref; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; logInvocationName = $f.logInvocationName; message = $f.message; ok = $f.ok; ok$1 = $f.ok$1; onLog = $f.onLog; str = $f.str; tokens = $f.tokens; x = $f.x; y = $f.y; y$1 = $f.y$1; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		if (onLog === undefined || onLog === null) {
			return;
		}
		message = "";
		_ref = tokens;
		_i = 0;
		/* while (true) { */ case 1:
			/* if (!(_i < _ref.$length)) { break; } */ if(!(_i < _ref.$length)) { $s = 2; continue; }
			x = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			str = "?";
			_tuple = $assertType(x, $String, true); y = _tuple[0]; ok = _tuple[1];
			/* */ if (ok) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (ok) { */ case 3:
				str = y;
				$s = 5; continue;
			/* } else { */ case 4:
				_tuple$1 = $assertType(x, $error, true); y$1 = _tuple$1[0]; ok$1 = _tuple$1[1];
				/* */ if (ok$1) { $s = 6; continue; }
				/* */ $s = 7; continue;
				/* if (ok$1) { */ case 6:
					_r = y$1.Error(); /* */ $s = 8; case 8: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
					str = _r;
				/* } */ case 7:
			/* } */ case 5:
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
		_r$1 = jsInvoke(logInvocationName, onLog, new sliceType$1([new $String(message)])); /* */ $s = 9; case 9: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_r$1;
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: Log }; } $f.$ptr = $ptr; $f._i = _i; $f._r = _r; $f._r$1 = _r$1; $f._ref = _ref; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f.logInvocationName = logInvocationName; $f.message = message; $f.ok = ok; $f.ok$1 = ok$1; $f.onLog = onLog; $f.str = str; $f.tokens = tokens; $f.x = x; $f.y = y; $f.y$1 = y$1; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.Log = Log;
	LongPollTransport = function(s, host) {
		var $ptr, _r, _r$1, _selection, _tuple, _tuple$1, _tuple$2, array, connWorked, creator, err, err$1, err$2, gotOnline, header, header$1, host, ok, response, s, url, $s, $deferred, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _selection = $f._selection; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; _tuple$2 = $f._tuple$2; array = $f.array; connWorked = $f.connWorked; creator = $f.creator; err = $f.err; err$1 = $f.err$1; err$2 = $f.err$2; gotOnline = $f.gotOnline; header = $f.header; header$1 = $f.header$1; host = $f.host; ok = $f.ok; response = $f.response; s = $f.s; url = $f.url; $s = $f.$s; $deferred = $f.$deferred; $r = $f.$r; } var $err = null; try { s: while (true) { switch ($s) { case 0: $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		connWorked = [connWorked];
		gotOnline = [gotOnline];
		s = [s];
		connWorked[0] = false;
		gotOnline[0] = false;
		$deferred.push([(function(connWorked, gotOnline, s) { return function $b() {
			var $ptr, err, $s, $r;
			/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; err = $f.err; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
			err = jsError($recover());
			/* */ if (!($interfaceIsEqual(err, $ifaceNil))) { $s = 1; continue; }
			/* */ $s = 2; continue;
			/* if (!($interfaceIsEqual(err, $ifaceNil))) { */ case 1:
				$r = s[0].log(new sliceType$1([new $String("poll:"), err])); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* } */ case 2:
			/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f.err = err; $f.$s = $s; $f.$r = $r; return $f;
		}; })(connWorked, gotOnline, s), []]);
		url = "https://" + host + "/v2/poll";
		/* */ if (s[0].sessionId === null) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (s[0].sessionId === null) { */ case 1:
			$r = s[0].log(new sliceType$1([new $String("session creation")])); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			header = s[0].makeCreateSessionAction();
			_tuple = XHR_JSON(url, new $jsObjectPtr(header), JitterDuration(new Duration(0, 13000), 0.2)); creator = _tuple[0]; err = _tuple[1];
			/* */ if (!($interfaceIsEqual(err, $ifaceNil))) { $s = 5; continue; }
			/* */ $s = 6; continue;
			/* if (!($interfaceIsEqual(err, $ifaceNil))) { */ case 5:
				$r = s[0].log(new sliceType$1([new $String("session creation:"), err])); /* */ $s = 7; case 7: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				return [connWorked[0], gotOnline[0]];
			/* } */ case 6:
			_r = $select([[creator], [s[0].closeNotify]]); /* */ $s = 8; case 8: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			_selection = _r;
			/* */ if (_selection[0] === 0) { $s = 9; continue; }
			/* */ if (_selection[0] === 1) { $s = 10; continue; }
			/* */ $s = 11; continue;
			/* if (_selection[0] === 0) { */ case 9:
				_tuple$1 = _selection[1]; response = _tuple$1[0]; ok = _tuple$1[1];
				/* */ if (!ok) { $s = 12; continue; }
				/* */ if (response === "") { $s = 13; continue; }
				/* */ $s = 14; continue;
				/* if (!ok) { */ case 12:
					$r = s[0].log(new sliceType$1([new $String("session creation timeout")])); /* */ $s = 15; case 15: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					return [connWorked[0], gotOnline[0]];
					$s = 14; continue;
				/* } else if (response === "") { */ case 13:
					$r = s[0].log(new sliceType$1([new $String("session creation error")])); /* */ $s = 16; case 16: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					return [connWorked[0], gotOnline[0]];
				/* } */ case 14:
				_tuple$2 = ParseJSON(response); array = _tuple$2[0]; err$1 = _tuple$2[1];
				/* */ if (!($interfaceIsEqual(err$1, $ifaceNil))) { $s = 17; continue; }
				/* */ $s = 18; continue;
				/* if (!($interfaceIsEqual(err$1, $ifaceNil))) { */ case 17:
					$r = s[0].log(new sliceType$1([new $String("session creation response:"), err$1])); /* */ $s = 19; case 19: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					return [connWorked[0], gotOnline[0]];
				/* } */ case 18:
				header$1 = array[0];
				_r$1 = s[0].handleSessionEvent(header$1); /* */ $s = 22; case 22: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
				/* */ if (!_r$1) { $s = 20; continue; }
				/* */ $s = 21; continue;
				/* if (!_r$1) { */ case 20:
					return [connWorked[0], gotOnline[0]];
				/* } */ case 21:
				$s = 11; continue;
			/* } else if (_selection[0] === 1) { */ case 10:
				$r = longPollClose(s[0], url); /* */ $s = 23; case 23: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				return [connWorked[0], gotOnline[0]];
			/* } */ case 11:
			connWorked[0] = true;
			gotOnline[0] = true;
			$r = s[0].connState("connected"); /* */ $s = 24; case 24: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			$r = s[0].connActive(); /* */ $s = 25; case 25: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			$s = 3; continue;
		/* } else { */ case 2:
			$r = s[0].log(new sliceType$1([new $String("session resumption")])); /* */ $s = 26; case 26: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			err$2 = longPollPing(s[0], url);
			/* */ if (!($interfaceIsEqual(err$2, $ifaceNil))) { $s = 27; continue; }
			/* */ $s = 28; continue;
			/* if (!($interfaceIsEqual(err$2, $ifaceNil))) { */ case 27:
				$r = s[0].log(new sliceType$1([new $String("session resumption:"), err$2])); /* */ $s = 29; case 29: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				return [connWorked[0], gotOnline[0]];
			/* } */ case 28:
		/* } */ case 3:
		$r = longPollTransfer(s[0], url, (connWorked.$ptr || (connWorked.$ptr = new ptrType$1(function() { return this.$target[0]; }, function($v) { this.$target[0] = $v; }, connWorked))), (gotOnline.$ptr || (gotOnline.$ptr = new ptrType$1(function() { return this.$target[0]; }, function($v) { this.$target[0] = $v; }, gotOnline)))); /* */ $s = 30; case 30: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		return [connWorked[0], gotOnline[0]];
		/* */ $s = -1; case -1: } return; } } catch(err) { $err = err; $s = -1; } finally { $callDeferred($deferred, $err); if (!$curGoroutine.asleep) { return  [connWorked[0], gotOnline[0]]; } if($curGoroutine.asleep) { if ($f === undefined) { $f = { $blk: LongPollTransport }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._selection = _selection; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f._tuple$2 = _tuple$2; $f.array = array; $f.connWorked = connWorked; $f.creator = creator; $f.err = err; $f.err$1 = err$1; $f.err$2 = err$2; $f.gotOnline = gotOnline; $f.header = header; $f.header$1 = header$1; $f.host = host; $f.ok = ok; $f.response = response; $f.s = s; $f.url = url; $f.$s = $s; $f.$deferred = $deferred; $f.$r = $r; return $f; } }
	};
	$pkg.LongPollTransport = LongPollTransport;
	longPollTransfer = function(s, url, connWorked, gotOnline) {
		var $ptr, _r, _r$1, _selection, _tuple, _tuple$1, _tuple$2, _tuple$3, _tuple$4, _tuple$5, _tuple$6, _tuple$7, _tuple$8, _tuple$9, ackedActionId, action, array, base64, channel, connWorked, err, err$1, err$2, err$3, err$4, err$5, failures, frame, gotOnline, header, header$1, i, json, object, ok, ok$1, payload, payload$1, poller, request, response, s, sender, sending, sendingId, sessionLost, url, x, x$1, x$2, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _selection = $f._selection; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; _tuple$2 = $f._tuple$2; _tuple$3 = $f._tuple$3; _tuple$4 = $f._tuple$4; _tuple$5 = $f._tuple$5; _tuple$6 = $f._tuple$6; _tuple$7 = $f._tuple$7; _tuple$8 = $f._tuple$8; _tuple$9 = $f._tuple$9; ackedActionId = $f.ackedActionId; action = $f.action; array = $f.array; base64 = $f.base64; channel = $f.channel; connWorked = $f.connWorked; err = $f.err; err$1 = $f.err$1; err$2 = $f.err$2; err$3 = $f.err$3; err$4 = $f.err$4; err$5 = $f.err$5; failures = $f.failures; frame = $f.frame; gotOnline = $f.gotOnline; header = $f.header; header$1 = $f.header$1; i = $f.i; json = $f.json; object = $f.object; ok = $f.ok; ok$1 = $f.ok$1; payload = $f.payload; payload$1 = $f.payload$1; poller = $f.poller; request = $f.request; response = $f.response; s = $f.s; sender = $f.sender; sending = $f.sending; sendingId = $f.sendingId; sessionLost = $f.sessionLost; url = $f.url; x = $f.x; x$1 = $f.x$1; x$2 = $f.x$2; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		poller = chanType.nil;
		sender = chanType.nil;
		sendingId = new $Uint64(0, 0);
		failures = 0;
		s.numSent = 0;
		/* while (true) { */ case 1:
			/* if (!(failures < 2)) { break; } */ if(!(failures < 2)) { $s = 2; continue; }
			/* */ if (poller === chanType.nil) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (poller === chanType.nil) { */ case 3:
				err = $ifaceNil;
				header = s.makeResumeSessionAction(true);
				_tuple = XHR_JSON(url, new $jsObjectPtr(header), JitterDuration(new Duration(0, 64000), 0.2)); poller = _tuple[0]; err = _tuple[1];
				/* */ if (!($interfaceIsEqual(err, $ifaceNil))) { $s = 5; continue; }
				/* */ $s = 6; continue;
				/* if (!($interfaceIsEqual(err, $ifaceNil))) { */ case 5:
					$r = s.log(new sliceType$1([new $String("poll:"), err])); /* */ $s = 7; case 7: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					return;
				/* } */ case 6:
			/* } */ case 4:
			/* */ if (sender === chanType.nil && s.numSent < s.sendBuffer.$length) { $s = 8; continue; }
			/* */ $s = 9; continue;
			/* if (sender === chanType.nil && s.numSent < s.sendBuffer.$length) { */ case 8:
				action = (x = s.sendBuffer, x$1 = s.numSent, ((x$1 < 0 || x$1 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + x$1]));
				/* */ if (!(action.Payload === null)) { $s = 10; continue; }
				/* */ $s = 11; continue;
				/* if (!(action.Payload === null)) { */ case 10:
					payload = null;
					err$1 = $ifaceNil;
					frame = action.Payload[0];
					/* */ if ($internalize(action.Header.action, $String) === "update_user") { $s = 12; continue; }
					/* */ $s = 13; continue;
					/* if ($internalize(action.Header.action, $String) === "update_user") { */ case 12:
						_tuple$1 = ParseDataURI(frame); base64 = _tuple$1[0]; err$2 = _tuple$1[1];
						/* */ if (!($interfaceIsEqual(err$2, $ifaceNil))) { $s = 15; continue; }
						/* */ $s = 16; continue;
						/* if (!($interfaceIsEqual(err$2, $ifaceNil))) { */ case 15:
							$r = s.log(new sliceType$1([new $String("send:"), err$2])); /* */ $s = 17; case 17: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
							return;
						/* } */ case 16:
						payload = NewArray();
						payload.push(base64);
						$s = 14; continue;
					/* } else { */ case 13:
						_tuple$2 = ParseJSON($internalize(frame, $String)); payload = _tuple$2[0]; err$1 = _tuple$2[1];
						/* */ if (!($interfaceIsEqual(err$1, $ifaceNil))) { $s = 18; continue; }
						/* */ $s = 19; continue;
						/* if (!($interfaceIsEqual(err$1, $ifaceNil))) { */ case 18:
							$r = s.log(new sliceType$1([new $String("send:"), err$1])); /* */ $s = 20; case 20: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
							return;
						/* } */ case 19:
					/* } */ case 14:
					action.Header.payload = payload;
				/* } */ case 11:
				action.Header.session_id = s.sessionId;
				_tuple$3 = StringifyJSON(new $jsObjectPtr(action.Header)); request = _tuple$3[0]; err$3 = _tuple$3[1];
				delete action.Header[$externalize("session_id", $String)];
				delete action.Header[$externalize("payload", $String)];
				/* */ if (!($interfaceIsEqual(err$3, $ifaceNil))) { $s = 21; continue; }
				/* */ $s = 22; continue;
				/* if (!($interfaceIsEqual(err$3, $ifaceNil))) { */ case 21:
					$r = s.log(new sliceType$1([new $String("send:"), err$3])); /* */ $s = 23; case 23: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					return;
				/* } */ case 22:
				_tuple$4 = XHR(url, request, JitterDuration(new Duration(0, 7000), 0.2)); channel = _tuple$4[0]; err$3 = _tuple$4[1];
				/* */ if (!($interfaceIsEqual(err$3, $ifaceNil))) { $s = 24; continue; }
				/* */ $s = 25; continue;
				/* if (!($interfaceIsEqual(err$3, $ifaceNil))) { */ case 24:
					$r = s.log(new sliceType$1([new $String("send:"), err$3])); /* */ $s = 26; case 26: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					return;
				/* } */ case 25:
				if ((x$2 = action.Id, (x$2.$high === 0 && x$2.$low === 0))) {
					s.sendBuffer = $appendSlice($subslice(s.sendBuffer, 0, s.numSent), $subslice(s.sendBuffer, (s.numSent + 1 >> 0)));
				} else {
					sender = channel;
					sendingId = action.Id;
				}
			/* } */ case 9:
			response = "";
			ok = false;
			_r = $select([[poller], [sender], [s.sendNotify], [s.closeNotify]]); /* */ $s = 27; case 27: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			_selection = _r;
			/* */ if (_selection[0] === 0) { $s = 28; continue; }
			/* */ if (_selection[0] === 1) { $s = 29; continue; }
			/* */ if (_selection[0] === 2) { $s = 30; continue; }
			/* */ if (_selection[0] === 3) { $s = 31; continue; }
			/* */ $s = 32; continue;
			/* if (_selection[0] === 0) { */ case 28:
				_tuple$5 = _selection[1]; response = _tuple$5[0]; ok = _tuple$5[1];
				/* */ if (!ok) { $s = 33; continue; }
				/* */ if (response === "") { $s = 34; continue; }
				/* */ $s = 35; continue;
				/* if (!ok) { */ case 33:
					$r = s.log(new sliceType$1([new $String("poll timeout")])); /* */ $s = 36; case 36: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					$s = 35; continue;
				/* } else if (response === "") { */ case 34:
					$r = s.log(new sliceType$1([new $String("poll error")])); /* */ $s = 37; case 37: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				/* } */ case 35:
				poller = chanType.nil;
				$r = s.connActive(); /* */ $s = 38; case 38: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				$s = 32; continue;
			/* } else if (_selection[0] === 1) { */ case 29:
				_tuple$6 = _selection[1]; response = _tuple$6[0]; ok = _tuple$6[1];
				/* */ if (!ok) { $s = 39; continue; }
				/* */ if (response === "") { $s = 40; continue; }
				/* */ if ((sendingId.$high > 0 || (sendingId.$high === 0 && sendingId.$low > 0))) { $s = 41; continue; }
				/* */ $s = 42; continue;
				/* if (!ok) { */ case 39:
					$r = s.log(new sliceType$1([new $String("send timeout")])); /* */ $s = 43; case 43: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					$s = 42; continue;
				/* } else if (response === "") { */ case 40:
					$r = s.log(new sliceType$1([new $String("send error")])); /* */ $s = 44; case 44: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					$s = 42; continue;
				/* } else if ((sendingId.$high > 0 || (sendingId.$high === 0 && sendingId.$low > 0))) { */ case 41:
					s.numSent = s.numSent + (1) >> 0;
				/* } */ case 42:
				sender = chanType.nil;
				sendingId = new $Uint64(0, 0);
				$s = 32; continue;
			/* } else if (_selection[0] === 2) { */ case 30:
				sending = _selection[1][0];
				/* */ if (!sending) { $s = 45; continue; }
				/* */ $s = 46; continue;
				/* if (!sending) { */ case 45:
					$r = longPollClose(s, url); /* */ $s = 47; case 47: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					return;
				/* } */ case 46:
				/* continue; */ $s = 1; continue;
				$s = 32; continue;
			/* } else if (_selection[0] === 3) { */ case 31:
				$r = longPollClose(s, url); /* */ $s = 48; case 48: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				return;
			/* } */ case 32:
			array = null;
			/* */ if (!(response === "")) { $s = 49; continue; }
			/* */ $s = 50; continue;
			/* if (!(response === "")) { */ case 49:
				err$4 = $ifaceNil;
				_tuple$7 = ParseJSON(response); array = _tuple$7[0]; err$4 = _tuple$7[1];
				/* */ if (!($interfaceIsEqual(err$4, $ifaceNil))) { $s = 51; continue; }
				/* */ $s = 52; continue;
				/* if (!($interfaceIsEqual(err$4, $ifaceNil))) { */ case 51:
					$r = s.log(new sliceType$1([new $String("response:"), err$4])); /* */ $s = 53; case 53: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				/* } */ case 52:
			/* } */ case 50:
			/* */ if (array === null) { $s = 54; continue; }
			/* */ $s = 55; continue;
			/* if (array === null) { */ case 54:
				failures = failures + (1) >> 0;
				s.numSent = 0;
				/* continue; */ $s = 1; continue;
			/* } */ case 55:
			failures = 0;
			connWorked.$set(true);
			i = 0;
			/* while (true) { */ case 56:
				/* if (!(i < $parseInt(array.length))) { break; } */ if(!(i < $parseInt(array.length))) { $s = 57; continue; }
				header$1 = array[i];
				payload$1 = NewArray();
				object = header$1.payload;
				/* */ if (!(object === undefined)) { $s = 58; continue; }
				/* */ $s = 59; continue;
				/* if (!(object === undefined)) { */ case 58:
					_tuple$8 = StringifyJSON(new $jsObjectPtr(object)); json = _tuple$8[0]; err$5 = _tuple$8[1];
					/* */ if (!($interfaceIsEqual(err$5, $ifaceNil))) { $s = 60; continue; }
					/* */ $s = 61; continue;
					/* if (!($interfaceIsEqual(err$5, $ifaceNil))) { */ case 60:
						$r = s.log(new sliceType$1([new $String("poll payload:"), err$5])); /* */ $s = 62; case 62: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
						return;
					/* } */ case 61:
					payload$1.push($externalize(json, $String));
				/* } */ case 59:
				_r$1 = s.handleEvent(header$1, payload$1); /* */ $s = 63; case 63: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
				_tuple$9 = _r$1; ackedActionId = _tuple$9[0]; sessionLost = _tuple$9[1]; ok$1 = _tuple$9[3];
				if ((sendingId.$high > 0 || (sendingId.$high === 0 && sendingId.$low > 0)) && (sendingId.$high < ackedActionId.$high || (sendingId.$high === ackedActionId.$high && sendingId.$low <= ackedActionId.$low))) {
					sendingId = new $Uint64(0, 0);
					s.numSent = s.numSent + (1) >> 0;
				}
				if (!ok$1) {
					if (sessionLost) {
						gotOnline.$set(true);
					}
					return;
				}
				/* */ if (!gotOnline.$get()) { $s = 64; continue; }
				/* */ $s = 65; continue;
				/* if (!gotOnline.$get()) { */ case 64:
					gotOnline.$set(true);
					$r = s.connState("connected"); /* */ $s = 66; case 66: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				/* } */ case 65:
				i = i + (1) >> 0;
			/* } */ $s = 56; continue; case 57:
		/* } */ $s = 1; continue; case 2:
		return;
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: longPollTransfer }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._selection = _selection; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f._tuple$2 = _tuple$2; $f._tuple$3 = _tuple$3; $f._tuple$4 = _tuple$4; $f._tuple$5 = _tuple$5; $f._tuple$6 = _tuple$6; $f._tuple$7 = _tuple$7; $f._tuple$8 = _tuple$8; $f._tuple$9 = _tuple$9; $f.ackedActionId = ackedActionId; $f.action = action; $f.array = array; $f.base64 = base64; $f.channel = channel; $f.connWorked = connWorked; $f.err = err; $f.err$1 = err$1; $f.err$2 = err$2; $f.err$3 = err$3; $f.err$4 = err$4; $f.err$5 = err$5; $f.failures = failures; $f.frame = frame; $f.gotOnline = gotOnline; $f.header = header; $f.header$1 = header$1; $f.i = i; $f.json = json; $f.object = object; $f.ok = ok; $f.ok$1 = ok$1; $f.payload = payload; $f.payload$1 = payload$1; $f.poller = poller; $f.request = request; $f.response = response; $f.s = s; $f.sender = sender; $f.sending = sending; $f.sendingId = sendingId; $f.sessionLost = sessionLost; $f.url = url; $f.x = x; $f.x$1 = x$1; $f.x$2 = x$2; $f.$s = $s; $f.$r = $r; return $f;
	};
	longPollPing = function(s, url) {
		var $ptr, _key, _map, _tuple, err, header, s, url;
		err = $ifaceNil;
		header = (_map = new $Map(), _key = "action", _map[_key] = { k: _key, v: new $String("ping") }, _key = "session_id", _map[_key] = { k: _key, v: new $jsObjectPtr(s.sessionId) }, _map);
		_tuple = XHR_JSON(url, new mapType(header), JitterDuration(new Duration(0, 7000), 0.9)); err = _tuple[1];
		return err;
	};
	longPollClose = function(s, url) {
		var $ptr, _key, _map, _tuple, err, header, s, url, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _key = $f._key; _map = $f._map; _tuple = $f._tuple; err = $f.err; header = $f.header; s = $f.s; url = $f.url; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		header = (_map = new $Map(), _key = "action", _map[_key] = { k: _key, v: new $String("close_session") }, _key = "session_id", _map[_key] = { k: _key, v: new $jsObjectPtr(s.sessionId) }, _map);
		_tuple = XHR_JSON(url, new mapType(header), JitterDuration(new Duration(0, 7000), 0.9)); err = _tuple[1];
		/* */ if (!($interfaceIsEqual(err, $ifaceNil))) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!($interfaceIsEqual(err, $ifaceNil))) { */ case 1:
			$r = s.log(new sliceType$1([new $String("send:"), err])); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 2:
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: longPollClose }; } $f.$ptr = $ptr; $f._key = _key; $f._map = _map; $f._tuple = _tuple; $f.err = err; $f.header = header; $f.s = s; $f.url = url; $f.$s = $s; $f.$r = $r; return $f;
	};
	main = function() {
		var $ptr;
		module.call = $externalize(Call, funcType$1);
		module.newSession = $externalize(NewSession, funcType$2);
		module.stringifyFrame = $externalize(StringifyFrame, funcType$3);
		$global.NinchatClient = module;
	};
	Defer = function() {
		var $ptr, _key, _map, d, promise;
		d = ptrType$3.nil;
		promise = false;
		d = new Deferred.ptr(sliceType$2.nil, sliceType$2.nil, sliceType$2.nil);
		promise = (_map = new $Map(), _key = "then", _map[_key] = { k: _key, v: new funcType$4($methodVal(d, "then")) }, _map);
		return [d, promise];
	};
	$pkg.Defer = Defer;
	Deferred.ptr.prototype.then = function(resolve, reject, notify) {
		var $ptr, d, notify, reject, resolve;
		d = this;
		if (!(resolve === undefined) && !(resolve === null)) {
			d.resolve = $append(d.resolve, resolve);
		}
		if (!(reject === undefined) && !(reject === null)) {
			d.reject = $append(d.reject, reject);
		}
		if (!(notify === undefined) && !(notify === null)) {
			d.notify = $append(d.notify, notify);
		}
	};
	Deferred.prototype.then = function(resolve, reject, notify) { return this.$val.then(resolve, reject, notify); };
	Deferred.ptr.prototype.Resolve = function(args) {
		var $ptr, _i, _r, _ref, args, callback, d, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _i = $f._i; _r = $f._r; _ref = $f._ref; args = $f.args; callback = $f.callback; d = $f.d; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		d = this;
		_ref = d.resolve;
		_i = 0;
		/* while (true) { */ case 1:
			/* if (!(_i < _ref.$length)) { break; } */ if(!(_i < _ref.$length)) { $s = 2; continue; }
			callback = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			_r = jsInvoke("NinchatClient promise resolve callback", callback, args); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			_r;
			_i++;
		/* } */ $s = 1; continue; case 2:
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: Deferred.ptr.prototype.Resolve }; } $f.$ptr = $ptr; $f._i = _i; $f._r = _r; $f._ref = _ref; $f.args = args; $f.callback = callback; $f.d = d; $f.$s = $s; $f.$r = $r; return $f;
	};
	Deferred.prototype.Resolve = function(args) { return this.$val.Resolve(args); };
	Deferred.ptr.prototype.Reject = function(args) {
		var $ptr, _i, _r, _ref, args, callback, d, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _i = $f._i; _r = $f._r; _ref = $f._ref; args = $f.args; callback = $f.callback; d = $f.d; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		d = this;
		_ref = d.reject;
		_i = 0;
		/* while (true) { */ case 1:
			/* if (!(_i < _ref.$length)) { break; } */ if(!(_i < _ref.$length)) { $s = 2; continue; }
			callback = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			_r = jsInvoke("NinchatClient promise reject callback", callback, args); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			_r;
			_i++;
		/* } */ $s = 1; continue; case 2:
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: Deferred.ptr.prototype.Reject }; } $f.$ptr = $ptr; $f._i = _i; $f._r = _r; $f._ref = _ref; $f.args = args; $f.callback = callback; $f.d = d; $f.$s = $s; $f.$r = $r; return $f;
	};
	Deferred.prototype.Reject = function(args) { return this.$val.Reject(args); };
	Deferred.ptr.prototype.Notify = function(args) {
		var $ptr, _i, _r, _ref, args, callback, d, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _i = $f._i; _r = $f._r; _ref = $f._ref; args = $f.args; callback = $f.callback; d = $f.d; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		d = this;
		_ref = d.notify;
		_i = 0;
		/* while (true) { */ case 1:
			/* if (!(_i < _ref.$length)) { break; } */ if(!(_i < _ref.$length)) { $s = 2; continue; }
			callback = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			_r = jsInvoke("NinchatClient promise notify callback", callback, args); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			_r;
			_i++;
		/* } */ $s = 1; continue; case 2:
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: Deferred.ptr.prototype.Notify }; } $f.$ptr = $ptr; $f._i = _i; $f._r = _r; $f._ref = _ref; $f.args = args; $f.callback = callback; $f.d = d; $f.$s = $s; $f.$r = $r; return $f;
	};
	Deferred.prototype.Notify = function(args) { return this.$val.Notify(args); };
	NewSession = function() {
		var $ptr, _key, _map, s;
		s = new Session.ptr(null, null, null, null, null, "api.ninchat.com", false, false, null, "", new Time(0, 0), new $Uint64(0, 0), chanType$1.nil, sliceType$3.nil, 0, false, new $Uint64(0, 0), new $Uint64(0, 0), chanType$1.nil, false, true);
		return (_map = new $Map(), _key = "onSessionEvent", _map[_key] = { k: _key, v: new funcType$5($methodVal(s, "OnSessionEvent")) }, _key = "onEvent", _map[_key] = { k: _key, v: new funcType$5($methodVal(s, "OnEvent")) }, _key = "onConnState", _map[_key] = { k: _key, v: new funcType$5($methodVal(s, "OnConnState")) }, _key = "onConnActive", _map[_key] = { k: _key, v: new funcType$5($methodVal(s, "OnConnActive")) }, _key = "onLog", _map[_key] = { k: _key, v: new funcType$5($methodVal(s, "OnLog")) }, _key = "setParams", _map[_key] = { k: _key, v: new funcType$6($methodVal(s, "SetParams")) }, _key = "setTransport", _map[_key] = { k: _key, v: new funcType$5($methodVal(s, "SetTransport")) }, _key = "setAddress", _map[_key] = { k: _key, v: new funcType$5($methodVal(s, "SetAddress")) }, _key = "open", _map[_key] = { k: _key, v: new funcType($methodVal(s, "Open")) }, _key = "close", _map[_key] = { k: _key, v: new funcType($methodVal(s, "Close")) }, _key = "send", _map[_key] = { k: _key, v: new funcType$7($methodVal(s, "Send")) }, _map);
	};
	$pkg.NewSession = NewSession;
	Session.ptr.prototype.OnSessionEvent = function(callback) {
		var $ptr, callback, s;
		s = this;
		s.onSessionEvent = callback;
	};
	Session.prototype.OnSessionEvent = function(callback) { return this.$val.OnSessionEvent(callback); };
	Session.ptr.prototype.OnEvent = function(callback) {
		var $ptr, callback, s;
		s = this;
		s.onEvent = callback;
	};
	Session.prototype.OnEvent = function(callback) { return this.$val.OnEvent(callback); };
	Session.ptr.prototype.OnConnState = function(callback) {
		var $ptr, _r, callback, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; callback = $f.callback; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		s = this;
		if (callback === null) {
			callback = null;
		}
		s.onConnState = callback;
		/* */ if (!(s.onConnState === null) && !(s.latestConnState === "")) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!(s.onConnState === null) && !(s.latestConnState === "")) { */ case 1:
			_r = jsInvoke("NinchatClient.Session onConnState callback", s.onConnState, new sliceType$1([new $String(s.latestConnState)])); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			_r;
		/* } */ case 2:
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: Session.ptr.prototype.OnConnState }; } $f.$ptr = $ptr; $f._r = _r; $f.callback = callback; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	Session.prototype.OnConnState = function(callback) { return this.$val.OnConnState(callback); };
	Session.ptr.prototype.OnConnActive = function(callback) {
		var $ptr, _r, callback, s, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; callback = $f.callback; s = $f.s; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		s = this;
		if (callback === null) {
			callback = null;
		}
		s.onConnActive = callback;
		/* */ if (!(s.onConnActive === null) && (x = s.latestConnActive, (x.$high > 0 || (x.$high === 0 && x.$low > 0)))) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!(s.onConnActive === null) && (x = s.latestConnActive, (x.$high > 0 || (x.$high === 0 && x.$low > 0)))) { */ case 1:
			_r = jsInvoke("NinchatClient.Session onConnActive callback", s.onConnActive, new sliceType$1([s.latestConnActive])); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			_r;
		/* } */ case 2:
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: Session.ptr.prototype.OnConnActive }; } $f.$ptr = $ptr; $f._r = _r; $f.callback = callback; $f.s = s; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	Session.prototype.OnConnActive = function(callback) { return this.$val.OnConnActive(callback); };
	Session.ptr.prototype.OnLog = function(callback) {
		var $ptr, callback, s;
		s = this;
		if (callback === null) {
			callback = null;
		}
		s.onLog = callback;
	};
	Session.prototype.OnLog = function(callback) { return this.$val.OnLog(callback); };
	Session.ptr.prototype.SetParams = function(params) {
		var $ptr, _entry, _entry$1, params, s, sessionId;
		s = this;
		if ((_entry = params["message_types"], _entry !== undefined ? _entry.v : null) === null) {
			$panic(new $String("message_types parameter not defined"));
		}
		sessionId = (_entry$1 = params["session_id"], _entry$1 !== undefined ? _entry$1.v : null);
		if (!(sessionId === null)) {
			s.sessionId = sessionId;
		}
		delete params["session_id"];
		s.sessionParams = params;
		if (!(s.sendNotify === chanType$1.nil) && s.stopped) {
			$go($methodVal(s, "discover"), []);
		}
	};
	Session.prototype.SetParams = function(params) { return this.$val.SetParams(params); };
	Session.ptr.prototype.SetTransport = function(name) {
		var $ptr, _ref, name, s, string;
		s = this;
		if (name === null) {
			s.forceLongPoll = false;
			return;
		}
		string = $internalize(name, $String);
		_ref = string;
		if (_ref === "websocket") {
			$panic(new $String("websocket transport cannot be forced"));
		} else if (_ref === "longpoll") {
			s.forceLongPoll = true;
		} else {
			$panic(new $String("unknown transport: " + string));
		}
	};
	Session.prototype.SetTransport = function(name) { return this.$val.SetTransport(name); };
	Session.ptr.prototype.SetAddress = function(address) {
		var $ptr, address, s;
		s = this;
		s.address = GetAddress(address);
	};
	Session.prototype.SetAddress = function(address) { return this.$val.SetAddress(address); };
	Session.ptr.prototype.Open = function() {
		var $ptr, s;
		s = this;
		if (s.closed) {
			$panic(new $String("session already closed"));
		}
		if (!(s.sendNotify === chanType$1.nil)) {
			$panic(new $String("session already initialized"));
		}
		if (s.onSessionEvent === null) {
			$panic(new $String("onSessionEvent callback not defined"));
		}
		if (s.onEvent === null) {
			$panic(new $String("onEvent callback not defined"));
		}
		if (s.sessionParams === false) {
			$panic(new $String("session parameters not defined"));
		}
		s.sendNotify = new chanType$1(1);
		s.closeNotify = new chanType$1(1);
		s.stopped = false;
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
			/* */ if (!(action.Deferred === ptrType$3.nil)) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (!(action.Deferred === ptrType$3.nil)) { */ case 3:
				$r = action.Deferred.Reject(new sliceType$1([])); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* } */ case 4:
			_i++;
		/* } */ $s = 1; continue; case 2:
		s[0].sendBuffer = sliceType$3.nil;
		s[0].numSent = 0;
		s[0].closed = true;
		s[0].stopped = true;
		$go((function(s) { return function $b() {
			var $ptr, $s, $r;
			/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
			$r = $send(s[0].closeNotify, true); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			$close(s[0].sendNotify);
			/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f.$s = $s; $f.$r = $r; return $f;
		}; })(s), []);
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: Session.ptr.prototype.Close }; } $f.$ptr = $ptr; $f._i = _i; $f._ref = _ref; $f.action = action; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	Session.prototype.Close = function() { return this.$val.Close(); };
	Session.ptr.prototype.Send = function(header, payload) {
		var $ptr, _tuple, action, header, payload, promise, s, x, x$1;
		promise = $ifaceNil;
		s = this;
		if (s.sendNotify === chanType$1.nil) {
			$panic(new $String("session not initialized"));
		}
		if (s.closed) {
			$panic(new $String("session already closed"));
		}
		if (payload === undefined || payload === null || ($parseInt(payload.length) === 0)) {
			payload = null;
		}
		action = new Action.ptr(new $Uint64(0, 0), header, payload, ptrType$3.nil, "");
		if (header.action_id === null) {
			delete header[$externalize("action_id", $String)];
		} else {
			s.lastActionId = (x = s.lastActionId, x$1 = new $Uint64(0, 1), new $Uint64(x.$high + x$1.$high, x.$low + x$1.$low));
			action.Id = s.lastActionId;
			header.action_id = $externalize(action.Id, $Uint64);
			_tuple = Defer(); action.Deferred = _tuple[0]; promise = new mapType(_tuple[1]);
		}
		s.send(action);
		return promise;
	};
	Session.prototype.Send = function(header, payload) { return this.$val.Send(header, payload); };
	Session.ptr.prototype.send = function(action) {
		var $ptr, action, s;
		s = this;
		s.sendBuffer = $append(s.sendBuffer, action);
		$go((function $b() {
			var $ptr, _selection, $r;
			/* */ var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _selection = $f._selection; $r = $f.$r; }
			_selection = $select([[s.sendNotify, true], []]);
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
			_selection = $select([[s.sendNotify, true], []]);
			/* */ if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f._selection = _selection; $f.$r = $r; return $f;
		}), []);
	};
	Session.prototype.sendAck = function() { return this.$val.sendAck(); };
	Session.ptr.prototype.discover = function() {
		var $ptr, _r, _r$1, _r$2, _selection, _tuple, _tuple$1, _tuple$2, backoff, channel, delay, err, err$1, hosts, ok, response, s, url, $s, $deferred, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _selection = $f._selection; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; _tuple$2 = $f._tuple$2; backoff = $f.backoff; channel = $f.channel; delay = $f.delay; err = $f.err; err$1 = $f.err$1; hosts = $f.hosts; ok = $f.ok; response = $f.response; s = $f.s; url = $f.url; $s = $f.$s; $deferred = $f.$deferred; $r = $f.$r; } var $err = null; try { s: while (true) { switch ($s) { case 0: $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		backoff = [backoff];
		s = this;
		$r = s.log(new sliceType$1([new $String("opening")])); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$deferred.push([$methodVal(s, "log"), [new sliceType$1([new $String("closed")])]]);
		$deferred.push([$methodVal(s, "connState"), ["disconnected"]]);
		backoff[0] = $clone(new Backoff.ptr(), Backoff);
		/* while (true) { */ case 2:
			/* if (!(!s.stopped)) { break; } */ if(!(!s.stopped)) { $s = 3; continue; }
			$r = s.log(new sliceType$1([new $String("endpoint discovery")])); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			$r = s.connState("connecting"); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			url = "https://" + s.address + "/v2/endpoint";
			_tuple = XHR(url, "", JitterDuration(new Duration(0, 7000), 0.1)); channel = _tuple[0]; err = _tuple[1];
			/* */ if (!($interfaceIsEqual(err, $ifaceNil))) { $s = 6; continue; }
			/* */ $s = 7; continue;
			/* if (!($interfaceIsEqual(err, $ifaceNil))) { */ case 6:
				$r = s.log(new sliceType$1([new $String("endpoint discovery:"), err])); /* */ $s = 9; case 9: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				$s = 8; continue;
			/* } else { */ case 7:
				_r = $select([[channel], [s.closeNotify]]); /* */ $s = 10; case 10: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				_selection = _r;
				/* */ if (_selection[0] === 0) { $s = 11; continue; }
				/* */ if (_selection[0] === 1) { $s = 12; continue; }
				/* */ $s = 13; continue;
				/* if (_selection[0] === 0) { */ case 11:
					_tuple$1 = _selection[1]; response = _tuple$1[0]; ok = _tuple$1[1];
					/* */ if (!ok) { $s = 14; continue; }
					/* */ if (response === "") { $s = 15; continue; }
					/* */ $s = 16; continue;
					/* if (!ok) { */ case 14:
						$r = s.log(new sliceType$1([new $String("endpoint discovery timeout")])); /* */ $s = 18; case 18: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
						$s = 17; continue;
					/* } else if (response === "") { */ case 15:
						$r = s.log(new sliceType$1([new $String("endpoint discovery error")])); /* */ $s = 19; case 19: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
						$s = 17; continue;
					/* } else { */ case 16:
						_tuple$2 = GetEndpointHosts(response); hosts = _tuple$2[0]; err$1 = _tuple$2[1];
						/* */ if (!($interfaceIsEqual(err$1, $ifaceNil))) { $s = 20; continue; }
						/* */ $s = 21; continue;
						/* if (!($interfaceIsEqual(err$1, $ifaceNil))) { */ case 20:
							$r = s.log(new sliceType$1([new $String("endpoint discovery:"), err$1])); /* */ $s = 23; case 23: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
							$s = 22; continue;
						/* } else { */ case 21:
							$r = s.log(new sliceType$1([new $String("endpoint discovered")])); /* */ $s = 24; case 24: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
							/* */ if ($pkg.WebSocketSupported && !s.forceLongPoll) { $s = 25; continue; }
							/* */ $s = 26; continue;
							/* if ($pkg.WebSocketSupported && !s.forceLongPoll) { */ case 25:
								_r$1 = s.connect(WebSocketTransport, hosts, backoff[0]); /* */ $s = 29; case 29: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
								/* */ if (_r$1) { $s = 27; continue; }
								/* */ $s = 28; continue;
								/* if (_r$1) { */ case 27:
									/* continue; */ $s = 2; continue;
								/* } */ case 28:
							/* } */ case 26:
							_r$2 = s.connect(LongPollTransport, hosts, backoff[0]); /* */ $s = 30; case 30: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
							_r$2;
						/* } */ case 22:
					/* } */ case 17:
					$s = 13; continue;
				/* } else if (_selection[0] === 1) { */ case 12:
					return;
				/* } */ case 13:
			/* } */ case 8:
			delay = backoff[0].Failure(new Duration(0, 60000));
			/* */ if ((delay.$high > 0 || (delay.$high === 0 && delay.$low > 0))) { $s = 31; continue; }
			/* */ $s = 32; continue;
			/* if ((delay.$high > 0 || (delay.$high === 0 && delay.$low > 0))) { */ case 31:
				$r = s.log(new sliceType$1([new $String("sleeping")])); /* */ $s = 33; case 33: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				$r = s.connState("disconnected"); /* */ $s = 34; case 34: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				$r = Sleep(delay); /* */ $s = 35; case 35: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* } */ case 32:
		/* } */ $s = 2; continue; case 3:
		/* */ $s = -1; case -1: } return; } } catch(err) { $err = err; $s = -1; } finally { $callDeferred($deferred, $err); if($curGoroutine.asleep) { if ($f === undefined) { $f = { $blk: Session.ptr.prototype.discover }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._selection = _selection; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f._tuple$2 = _tuple$2; $f.backoff = backoff; $f.channel = channel; $f.delay = delay; $f.err = err; $f.err$1 = err$1; $f.hosts = hosts; $f.ok = ok; $f.response = response; $f.s = s; $f.url = url; $f.$s = $s; $f.$deferred = $deferred; $f.$r = $r; return $f; } }
	};
	Session.prototype.discover = function() { return this.$val.discover(); };
	Session.ptr.prototype.connect = function(transport, hosts, backoff) {
		var $ptr, _i, _i$1, _r, _ref, _ref$1, _rune, _tuple, backoff, c, connWorked, delay, gotOnline, host, hosts, i, s, transport, transportWorked, trial, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _i = $f._i; _i$1 = $f._i$1; _r = $f._r; _ref = $f._ref; _ref$1 = $f._ref$1; _rune = $f._rune; _tuple = $f._tuple; backoff = $f.backoff; c = $f.c; connWorked = $f.connWorked; delay = $f.delay; gotOnline = $f.gotOnline; host = $f.host; hosts = $f.hosts; i = $f.i; s = $f.s; transport = $f.transport; transportWorked = $f.transportWorked; trial = $f.trial; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
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
				_ref$1 = s.address;
				_i$1 = 0;
				while (true) {
					if (!(_i$1 < _ref$1.length)) { break; }
					_rune = $decodeRune(_ref$1, _i$1);
					i = _i$1;
					c = _rune[0];
					if (c === 47) {
						host = host + (s.address.substring(i));
						break;
					}
					_i$1 += _rune[1];
				}
				_r = transport(s, host); /* */ $s = 6; case 6: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				_tuple = _r; connWorked = _tuple[0]; gotOnline = _tuple[1];
				if (connWorked) {
					transportWorked = true;
				}
				if (gotOnline) {
					backoff.Success();
					return transportWorked;
				}
				if (s.stopped) {
					return transportWorked;
				}
				delay = backoff.Failure(new Duration(0, 60000));
				/* */ if ((delay.$high > 0 || (delay.$high === 0 && delay.$low > 0))) { $s = 7; continue; }
				/* */ $s = 8; continue;
				/* if ((delay.$high > 0 || (delay.$high === 0 && delay.$low > 0))) { */ case 7:
					$r = s.log(new sliceType$1([new $String("sleeping")])); /* */ $s = 9; case 9: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					$r = s.connState("disconnected"); /* */ $s = 10; case 10: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					$r = Sleep(delay); /* */ $s = 11; case 11: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				/* } */ case 8:
				_i++;
			/* } */ $s = 3; continue; case 4:
			trial = trial + (1) >> 0;
		/* } */ $s = 1; continue; case 2:
		return transportWorked;
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: Session.ptr.prototype.connect }; } $f.$ptr = $ptr; $f._i = _i; $f._i$1 = _i$1; $f._r = _r; $f._ref = _ref; $f._ref$1 = _ref$1; $f._rune = _rune; $f._tuple = _tuple; $f.backoff = backoff; $f.c = c; $f.connWorked = connWorked; $f.delay = delay; $f.gotOnline = gotOnline; $f.host = host; $f.hosts = hosts; $f.i = i; $f.s = s; $f.transport = transport; $f.transportWorked = transportWorked; $f.trial = trial; $f.$s = $s; $f.$r = $r; return $f;
	};
	Session.prototype.connect = function(transport, hosts, backoff) { return this.$val.connect(transport, hosts, backoff); };
	Session.ptr.prototype.canLogin = function() {
		var $ptr, _entry, _entry$1, _entry$2, _entry$3, _entry$4, _entry$5, _entry$6, s;
		s = this;
		if (!((_entry = s.sessionParams["access_key"], _entry !== undefined ? _entry.v : null) === null)) {
			return true;
		}
		if (!((_entry$1 = s.sessionParams["user_id"], _entry$1 !== undefined ? _entry$1.v : null) === null)) {
			return !((_entry$2 = s.sessionParams["user_auth"], _entry$2 !== undefined ? _entry$2.v : null) === null) || !((_entry$3 = s.sessionParams["master_sign"], _entry$3 !== undefined ? _entry$3.v : null) === null);
		}
		return !((_entry$4 = s.sessionParams["identity_type"], _entry$4 !== undefined ? _entry$4.v : null) === null) && !((_entry$5 = s.sessionParams["identity_name"], _entry$5 !== undefined ? _entry$5.v : null) === null) && !((_entry$6 = s.sessionParams["identity_auth"], _entry$6 !== undefined ? _entry$6.v : null) === null);
	};
	Session.prototype.canLogin = function() { return this.$val.canLogin(); };
	Session.ptr.prototype.makeCreateSessionAction = function() {
		var $ptr, _entry, _entry$1, _entry$2, _entry$3, _entry$4, _entry$5, _entry$6, _entry$7, _i, _i$1, _keys, _keys$1, _ref, _ref$1, _ref$2, header, identityType, key, key$1, masterSign, s, userAuth, userId, value, value$1;
		header = null;
		s = this;
		header = NewObject();
		header.action = $externalize("create_session", $String);
		userId = (_entry = s.sessionParams["user_id"], _entry !== undefined ? _entry.v : null);
		if (userId === null) {
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
				header[$externalize(key, $String)] = value;
				_i++;
			}
		} else {
			userAuth = (_entry$2 = s.sessionParams["user_auth"], _entry$2 !== undefined ? _entry$2.v : null);
			if (!(userAuth === null)) {
				header.user_id = userId;
				header.user_auth = userAuth;
			} else {
				masterSign = (_entry$3 = s.sessionParams["master_sign"], _entry$3 !== undefined ? _entry$3.v : null);
				if (!(masterSign === null)) {
					header.user_id = userId;
					header.master_sign = masterSign;
				} else {
					identityType = (_entry$4 = s.sessionParams["identity_type"], _entry$4 !== undefined ? _entry$4.v : null);
					if (!(identityType === null)) {
						header.identity_type = identityType;
						header.identity_name = (_entry$5 = s.sessionParams["identity_name"], _entry$5 !== undefined ? _entry$5.v : null);
						header.identity_auth = (_entry$6 = s.sessionParams["identity_auth"], _entry$6 !== undefined ? _entry$6.v : null);
					} else {
						header.user_id = userId;
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
					header[$externalize(key$1, $String)] = value$1;
				}
				_i$1++;
			}
		}
		return header;
	};
	Session.prototype.makeCreateSessionAction = function() { return this.$val.makeCreateSessionAction(); };
	Session.ptr.prototype.makeResumeSessionAction = function(session) {
		var $ptr, header, s, session;
		header = null;
		s = this;
		header = NewObject();
		header.action = $externalize("resume_session", $String);
		header.event_id = $externalize(s.receivedEventId, $Uint64);
		if (session) {
			header.session_id = s.sessionId;
		}
		s.sendEventAck = false;
		s.ackedEventId = s.receivedEventId;
		return header;
	};
	Session.prototype.makeResumeSessionAction = function(session) { return this.$val.makeResumeSessionAction(session); };
	Session.ptr.prototype.handleSessionEvent = function(header) {
		var $ptr, _entry, _i, _key, _key$1, _key$2, _r, _ref, _tuple, err, eventId, header, newValue, ok, param, s, sessionId, userAuth, userId, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _entry = $f._entry; _i = $f._i; _key = $f._key; _key$1 = $f._key$1; _key$2 = $f._key$2; _r = $f._r; _ref = $f._ref; _tuple = $f._tuple; err = $f.err; eventId = $f.eventId; header = $f.header; newValue = $f.newValue; ok = $f.ok; param = $f.param; s = $f.s; sessionId = $f.sessionId; userAuth = $f.userAuth; userId = $f.userId; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		ok = false;
		s = this;
		_tuple = GetSessionEventCredentials(header); userId = _tuple[0]; userAuth = _tuple[1]; sessionId = _tuple[2]; eventId = _tuple[3]; ok = _tuple[4]; err = _tuple[5];
		/* */ if (!($interfaceIsEqual(err, $ifaceNil))) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!($interfaceIsEqual(err, $ifaceNil))) { */ case 1:
			$r = s.log(new sliceType$1([new $String("session creation:"), err])); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 2:
		_r = jsInvoke("NinchatClient.Session onSessionEvent callback", s.onSessionEvent, new sliceType$1([new $jsObjectPtr(header)])); /* */ $s = 6; case 6: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ if (!_r) { $s = 4; continue; }
		/* */ $s = 5; continue;
		/* if (!_r) { */ case 4:
			ok = false;
		/* } */ case 5:
		if (!ok) {
			s.sessionId = null;
			s.stopped = true;
			return ok;
		}
		delete s.sessionParams["user_attrs"];
		delete s.sessionParams["user_settings"];
		delete s.sessionParams["identity_attrs"];
		delete s.sessionParams["access_key"];
		delete s.sessionParams["master_sign"];
		_key = "user_id"; (s.sessionParams || $throwRuntimeError("assignment to entry in nil map"))[_key] = { k: _key, v: userId };
		if (!(userAuth === null)) {
			_key$1 = "user_auth"; (s.sessionParams || $throwRuntimeError("assignment to entry in nil map"))[_key$1] = { k: _key$1, v: userAuth };
		}
		_ref = new sliceType(["identity_type", "identity_name", "identity_auth"]);
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			param = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			newValue = (_entry = s.sessionParams[param + "_new"], _entry !== undefined ? _entry.v : null);
			if (!(newValue === null)) {
				delete s.sessionParams[param + "_new"];
				_key$2 = param; (s.sessionParams || $throwRuntimeError("assignment to entry in nil map"))[_key$2] = { k: _key$2, v: newValue };
			}
			_i++;
		}
		s.sessionId = sessionId;
		if (s.sendBuffer.$length === 0) {
			s.lastActionId = new $Uint64(0, 0);
		}
		s.sendEventAck = false;
		s.receivedEventId = eventId;
		s.ackedEventId = new $Uint64(0, 0);
		$r = s.log(new sliceType$1([new $String("session created")])); /* */ $s = 7; case 7: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		ok = true;
		return ok;
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: Session.ptr.prototype.handleSessionEvent }; } $f.$ptr = $ptr; $f._entry = _entry; $f._i = _i; $f._key = _key; $f._key$1 = _key$1; $f._key$2 = _key$2; $f._r = _r; $f._ref = _ref; $f._tuple = _tuple; $f.err = err; $f.eventId = eventId; $f.header = header; $f.newValue = newValue; $f.ok = ok; $f.param = param; $f.s = s; $f.sessionId = sessionId; $f.userAuth = userAuth; $f.userId = userId; $f.$s = $s; $f.$r = $r; return $f;
	};
	Session.prototype.handleSessionEvent = function(header) { return this.$val.handleSessionEvent(header); };
	Session.ptr.prototype.handleEvent = function(header, payload) {
		var $ptr, _r, _r$1, _r$2, _tuple, _tuple$1, _tuple$2, action, actionId, err, err$1, errorReason, errorType, eventId, header, i, lastReply, needsAck, ok, payload, s, sessionLost, x, x$1, x$2, x$3, x$4, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; _tuple$2 = $f._tuple$2; action = $f.action; actionId = $f.actionId; err = $f.err; err$1 = $f.err$1; errorReason = $f.errorReason; errorType = $f.errorType; eventId = $f.eventId; header = $f.header; i = $f.i; lastReply = $f.lastReply; needsAck = $f.needsAck; ok = $f.ok; payload = $f.payload; s = $f.s; sessionLost = $f.sessionLost; x = $f.x; x$1 = $f.x$1; x$2 = $f.x$2; x$3 = $f.x$3; x$4 = $f.x$4; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		actionId = [actionId];
		s = [s];
		actionId[0] = new $Uint64(0, 0);
		sessionLost = false;
		needsAck = false;
		ok = false;
		s[0] = this;
		_tuple = GetEventAndActionId(header); eventId = _tuple[0]; actionId[0] = _tuple[1]; err = _tuple[2];
		/* */ if (!($interfaceIsEqual(err, $ifaceNil))) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!($interfaceIsEqual(err, $ifaceNil))) { */ case 1:
			$r = s[0].log(new sliceType$1([new $String("event:"), err])); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			return [actionId[0], sessionLost, needsAck, ok];
		/* } */ case 2:
		if ((eventId.$high > 0 || (eventId.$high === 0 && eventId.$low > 0))) {
			s[0].receivedEventId = eventId;
			if (!s[0].sendEventAck) {
				if ((x = (x$1 = s[0].receivedEventId, x$2 = s[0].ackedEventId, new $Uint64(x$1.$high - x$2.$high, x$1.$low - x$2.$low)), (x.$high > sessionEventAckWindow.$high || (x.$high === sessionEventAckWindow.$high && x.$low >= sessionEventAckWindow.$low)))) {
					s[0].sendAck();
				} else {
					needsAck = true;
				}
			}
		}
		/* */ if ((actionId[0].$high > 0 || (actionId[0].$high === 0 && actionId[0].$low > 0))) { $s = 4; continue; }
		/* */ $s = 5; continue;
		/* if ((actionId[0].$high > 0 || (actionId[0].$high === 0 && actionId[0].$low > 0))) { */ case 4:
			_r = sort.Search(s[0].numSent, (function(actionId, s) { return function(i) {
				var $ptr, action, i, x$3, x$4;
				action = (x$3 = s[0].sendBuffer, ((i < 0 || i >= x$3.$length) ? $throwRuntimeError("index out of range") : x$3.$array[x$3.$offset + i]));
				return (x$4 = action.Id, (x$4.$high > actionId[0].$high || (x$4.$high === actionId[0].$high && x$4.$low >= actionId[0].$low)));
			}; })(actionId, s)); /* */ $s = 6; case 6: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			i = _r;
			/* */ if (i < s[0].numSent) { $s = 7; continue; }
			/* */ $s = 8; continue;
			/* if (i < s[0].numSent) { */ case 7:
				action = (x$3 = s[0].sendBuffer, ((i < 0 || i >= x$3.$length) ? $throwRuntimeError("index out of range") : x$3.$array[x$3.$offset + i]));
				/* */ if ((x$4 = action.Id, (x$4.$high === actionId[0].$high && x$4.$low === actionId[0].$low))) { $s = 9; continue; }
				/* */ $s = 10; continue;
				/* if ((x$4 = action.Id, (x$4.$high === actionId[0].$high && x$4.$low === actionId[0].$low))) { */ case 9:
					_tuple$1 = IsEventLastReply(header, action); lastReply = _tuple$1[0]; err$1 = _tuple$1[1];
					/* */ if (!($interfaceIsEqual(err$1, $ifaceNil))) { $s = 11; continue; }
					/* */ $s = 12; continue;
					/* if (!($interfaceIsEqual(err$1, $ifaceNil))) { */ case 11:
						$r = s[0].log(new sliceType$1([new $String("event:"), err$1])); /* */ $s = 13; case 13: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
						return [actionId[0], sessionLost, needsAck, ok];
					/* } */ case 12:
					/* */ if (!(action.Deferred === ptrType$3.nil)) { $s = 14; continue; }
					/* */ $s = 15; continue;
					/* if (!(action.Deferred === ptrType$3.nil)) { */ case 14:
						/* */ if (lastReply) { $s = 16; continue; }
						/* */ $s = 17; continue;
						/* if (lastReply) { */ case 16:
							$r = action.Deferred.Resolve(new sliceType$1([new $jsObjectPtr(header), new $jsObjectPtr(payload)])); /* */ $s = 19; case 19: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
							$s = 18; continue;
						/* } else { */ case 17:
							$r = action.Deferred.Notify(new sliceType$1([new $jsObjectPtr(header), new $jsObjectPtr(payload)])); /* */ $s = 20; case 20: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
						/* } */ case 18:
					/* } */ case 15:
					if (lastReply) {
						s[0].sendBuffer = $appendSlice($subslice(s[0].sendBuffer, 0, i), $subslice(s[0].sendBuffer, (i + 1 >> 0)));
						s[0].numSent = s[0].numSent - (1) >> 0;
					}
				/* } */ case 10:
			/* } */ case 8:
		/* } */ case 5:
		_tuple$2 = GetEventError(header); errorType = _tuple$2[0]; errorReason = _tuple$2[1]; sessionLost = _tuple$2[2]; err = _tuple$2[3];
		/* */ if (!($interfaceIsEqual(err, $ifaceNil))) { $s = 21; continue; }
		/* */ $s = 22; continue;
		/* if (!($interfaceIsEqual(err, $ifaceNil))) { */ case 21:
			$r = s[0].log(new sliceType$1([new $String("event:"), err])); /* */ $s = 23; case 23: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* */ if (sessionLost) { $s = 24; continue; }
			/* */ $s = 25; continue;
			/* if (sessionLost) { */ case 24:
				s[0].sessionId = null;
				/* */ if (!s[0].canLogin()) { $s = 26; continue; }
				/* */ $s = 27; continue;
				/* if (!s[0].canLogin()) { */ case 26:
					_r$1 = jsInvoke("NinchatClient.Session onSessionEvent callback", s[0].onSessionEvent, new sliceType$1([new $jsObjectPtr(header)])); /* */ $s = 28; case 28: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
					_r$1;
					s[0].stopped = true;
				/* } */ case 27:
			/* } */ case 25:
			return [actionId[0], sessionLost, needsAck, ok];
		/* } */ case 22:
		/* */ if (errorType === "deprecated") { $s = 29; continue; }
		/* */ $s = 30; continue;
		/* if (errorType === "deprecated") { */ case 29:
			$r = s[0].log(new sliceType$1([new $String("deprecated:"), new $String(errorReason)])); /* */ $s = 31; case 31: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 30:
		_r$2 = jsInvoke("NinchatClient.Session onEvent callback", s[0].onEvent, new sliceType$1([new $jsObjectPtr(header), new $jsObjectPtr(payload)])); /* */ $s = 34; case 34: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		/* */ if (!_r$2) { $s = 32; continue; }
		/* */ $s = 33; continue;
		/* if (!_r$2) { */ case 32:
			return [actionId[0], sessionLost, needsAck, ok];
		/* } */ case 33:
		ok = true;
		return [actionId[0], sessionLost, needsAck, ok];
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: Session.ptr.prototype.handleEvent }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f._tuple$2 = _tuple$2; $f.action = action; $f.actionId = actionId; $f.err = err; $f.err$1 = err$1; $f.errorReason = errorReason; $f.errorType = errorType; $f.eventId = eventId; $f.header = header; $f.i = i; $f.lastReply = lastReply; $f.needsAck = needsAck; $f.ok = ok; $f.payload = payload; $f.s = s; $f.sessionLost = sessionLost; $f.x = x; $f.x$1 = x$1; $f.x$2 = x$2; $f.x$3 = x$3; $f.x$4 = x$4; $f.$s = $s; $f.$r = $r; return $f;
	};
	Session.prototype.handleEvent = function(header, payload) { return this.$val.handleEvent(header, payload); };
	Session.ptr.prototype.connState = function(state) {
		var $ptr, _r, s, state, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; s = $f.s; state = $f.state; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		s = this;
		/* */ if (!(s.latestConnState === state)) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!(s.latestConnState === state)) { */ case 1:
			s.latestConnState = state;
			/* */ if (!(s.onConnState === null)) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (!(s.onConnState === null)) { */ case 3:
				_r = jsInvoke("NinchatClient.Session onConnState callback", s.onConnState, new sliceType$1([new $String(s.latestConnState)])); /* */ $s = 5; case 5: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				_r;
			/* } */ case 4:
		/* } */ case 2:
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: Session.ptr.prototype.connState }; } $f.$ptr = $ptr; $f._r = _r; $f.s = s; $f.state = state; $f.$s = $s; $f.$r = $r; return $f;
	};
	Session.prototype.connState = function(state) { return this.$val.connState(state); };
	Session.ptr.prototype.connActive = function() {
		var $ptr, _r, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		s = this;
		s.latestConnActive = Now();
		/* */ if (!(s.onConnActive === null)) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!(s.onConnActive === null)) { */ case 1:
			_r = jsInvoke("NinchatClient.Session onConnActive callback", s.onConnActive, new sliceType$1([s.latestConnActive])); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			_r;
		/* } */ case 2:
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: Session.ptr.prototype.connActive }; } $f.$ptr = $ptr; $f._r = _r; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	Session.prototype.connActive = function() { return this.$val.connActive(); };
	Session.ptr.prototype.log = function(tokens) {
		var $ptr, s, tokens, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; s = $f.s; tokens = $f.tokens; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		s = this;
		$r = Log("NinchatClient.Session onLog callback", s.onLog, tokens); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: Session.ptr.prototype.log }; } $f.$ptr = $ptr; $f.s = s; $f.tokens = tokens; $f.$s = $s; $f.$r = $r; return $f;
	};
	Session.prototype.log = function(tokens) { return this.$val.log(tokens); };
	Now = function() {
		var $ptr, x;
		return (x = $internalize(new ($global.Date)().getTime(), $Int64), new Time(x.$high, x.$low));
	};
	$pkg.Now = Now;
	NewTimer = function(timeout) {
		var $ptr, timeout, timer;
		timer = ptrType$5.nil;
		timer = new Timer.ptr(new chanType$1(0), null);
		if ((timeout.$high > 0 || (timeout.$high === 0 && timeout.$low >= 0))) {
			timer.Reset(timeout);
		}
		return timer;
	};
	$pkg.NewTimer = NewTimer;
	Timer.ptr.prototype.Active = function() {
		var $ptr, timer;
		timer = this;
		return !(timer.id === null);
	};
	Timer.prototype.Active = function() { return this.$val.Active(); };
	Timer.ptr.prototype.Reset = function(timeout) {
		var $ptr, timeout, timer;
		timer = this;
		timer.Stop();
		timer.id = SetTimeout((function() {
			var $ptr;
			timer.id = null;
			$go((function $b() {
				var $ptr, $s, $r;
				/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
				$r = $send(timer.C, true); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f.$s = $s; $f.$r = $r; return $f;
			}), []);
		}), timeout);
	};
	Timer.prototype.Reset = function(timeout) { return this.$val.Reset(timeout); };
	Timer.ptr.prototype.Stop = function() {
		var $ptr, timer;
		timer = this;
		if (!(timer.id === null)) {
			ClearTimeout(timer.id);
			timer.id = null;
		}
	};
	Timer.prototype.Stop = function() { return this.$val.Stop(); };
	Sleep = function(delay) {
		var $ptr, _r, delay, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; delay = $f.delay; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = $recv(NewTimer(delay).C); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_r[0];
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: Sleep }; } $f.$ptr = $ptr; $f._r = _r; $f.delay = delay; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.Sleep = Sleep;
	NewWebSocket = function(url) {
		var $ptr, url, ws;
		ws = ptrType$6.nil;
		ws = new WebSocket.ptr(new chanType$1(1), false, new ($global.WebSocket)($externalize(url, $String)), false, $ifaceNil, sliceType$2.nil);
		ws.impl.binaryType = $externalize("arraybuffer", $String);
		ws.impl.onopen = $externalize((function(param) {
			var $ptr, param;
			ws.open = true;
			$go((function $b() {
				var $ptr, $s, $r;
				/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
				$r = $send(ws.Notify, true); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f.$s = $s; $f.$r = $r; return $f;
			}), []);
		}), funcType$5);
		ws.impl.onmessage = $externalize((function(object) {
			var $ptr, object;
			ws.buffer = $append(ws.buffer, object.data);
			$go((function $b() {
				var $ptr, _selection, $r;
				/* */ var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _selection = $f._selection; $r = $f.$r; }
				_selection = $select([[ws.Notify, true], []]);
				/* */ if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f._selection = _selection; $f.$r = $r; return $f;
			}), []);
		}), funcType$5);
		ws.impl.onclose = $externalize((function(object) {
			var $ptr, object;
			ws.GoingAway = ($parseInt(object.code) >> 0) === 1001;
			ws.open = false;
			$go((function() {
				var $ptr;
				$close(ws.Notify);
			}), []);
		}), funcType$5);
		ws.impl.onerror = $externalize((function(object) {
			var $ptr, object;
			ws.error = errors.New("WebSocket error event");
		}), funcType$5);
		return ws;
	};
	$pkg.NewWebSocket = NewWebSocket;
	WebSocket.ptr.prototype.Send = function(data) {
		var $ptr, data, err, ws, $deferred;
		/* */ var $err = null; try { $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		err = $ifaceNil;
		ws = this;
		$deferred.push([(function() {
			var $ptr;
			err = jsError($recover());
		}), []]);
		err = ws.error;
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			return err;
		}
		ws.impl.send($externalize(data, $emptyInterface));
		return err;
		/* */ } catch(err) { $err = err; } finally { $callDeferred($deferred, $err); if (!$curGoroutine.asleep) { return  err; } }
	};
	WebSocket.prototype.Send = function(data) { return this.$val.Send(data); };
	WebSocket.ptr.prototype.SendJSON = function(object) {
		var $ptr, _tuple, err, json, object, ws;
		err = $ifaceNil;
		ws = this;
		_tuple = StringifyJSON(object); json = _tuple[0]; err = _tuple[1];
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			return err;
		}
		err = ws.Send(new $String(json));
		return err;
	};
	WebSocket.prototype.SendJSON = function(object) { return this.$val.SendJSON(object); };
	WebSocket.ptr.prototype.Receive = function() {
		var $ptr, data, err, ws, x;
		data = null;
		err = $ifaceNil;
		ws = this;
		err = ws.error;
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			return [data, err];
		}
		if (!ws.open) {
			return [data, err];
		}
		if (ws.buffer.$length > 0) {
			data = (x = ws.buffer, (0 >= x.$length ? $throwRuntimeError("index out of range") : x.$array[x.$offset + 0]));
			ws.buffer = $subslice(ws.buffer, 1);
		}
		return [data, err];
	};
	WebSocket.prototype.Receive = function() { return this.$val.Receive(); };
	WebSocket.ptr.prototype.ReceiveJSON = function() {
		var $ptr, _tuple, _tuple$1, data, err, object, ws;
		object = null;
		err = $ifaceNil;
		ws = this;
		_tuple = ws.Receive(); data = _tuple[0]; err = _tuple[1];
		if (!($interfaceIsEqual(err, $ifaceNil)) || data === null) {
			return [object, err];
		}
		_tuple$1 = ParseJSON(StringifyFrame(data)); object = _tuple$1[0]; err = _tuple$1[1];
		return [object, err];
	};
	WebSocket.prototype.ReceiveJSON = function() { return this.$val.ReceiveJSON(); };
	WebSocket.ptr.prototype.Close = function() {
		var $ptr, err, ws, $deferred;
		/* */ var $err = null; try { $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		err = $ifaceNil;
		ws = this;
		$deferred.push([(function() {
			var $ptr;
			err = jsError($recover());
		}), []]);
		ws.impl.close();
		err = ws.error;
		return err;
		/* */ } catch(err) { $err = err; } finally { $callDeferred($deferred, $err); if (!$curGoroutine.asleep) { return  err; } }
	};
	WebSocket.prototype.Close = function() { return this.$val.Close(); };
	StringifyFrame = function(data) {
		var $ptr, _tuple, bytes, data, ok, s, view;
		s = "";
		_tuple = $assertType($internalize(data, $emptyInterface), $String, true); s = _tuple[0]; ok = _tuple[1];
		if (ok) {
			return s;
		}
		view = NewUint8Array(data);
		bytes = $assertType($internalize(view, $emptyInterface), sliceType$4);
		s = $bytesToString(bytes);
		return s;
	};
	$pkg.StringifyFrame = StringifyFrame;
	WebSocketTransport = function(s, host) {
		var $ptr, _r, _r$1, _selection, _tuple, connWorked, connectTimer, connected, goingAway, gotOnline, host, hostHealthy, s, ws, $s, $deferred, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _selection = $f._selection; _tuple = $f._tuple; connWorked = $f.connWorked; connectTimer = $f.connectTimer; connected = $f.connected; goingAway = $f.goingAway; gotOnline = $f.gotOnline; host = $f.host; hostHealthy = $f.hostHealthy; s = $f.s; ws = $f.ws; $s = $f.$s; $deferred = $f.$deferred; $r = $f.$r; } var $err = null; try { s: while (true) { switch ($s) { case 0: $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		ws = [ws];
		connWorked = false;
		gotOnline = false;
		ws[0] = ptrType$6.nil;
		$deferred.push([(function(ws) { return function() {
			var $ptr;
			if (!(ws[0] === ptrType$6.nil)) {
				ws[0].Close();
			}
		}; })(ws), []]);
		connectTimer = NewTimer(new Duration(-1, 4294967295));
		$deferred.push([$methodVal(connectTimer, "Stop"), []]);
		/* while (true) { */ case 1:
			gotOnline = false;
			hostHealthy = false;
			$r = s.log(new sliceType$1([new $String("connecting to"), new $String(host)])); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			ws[0] = NewWebSocket("wss://" + host + "/v2/socket");
			connectTimer.Reset(JitterDuration(new Duration(0, 9000), 0.1));
			_r = $select([[ws[0].Notify], [connectTimer.C], [s.closeNotify]]); /* */ $s = 4; case 4: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			_selection = _r;
			/* */ if (_selection[0] === 0) { $s = 5; continue; }
			/* */ if (_selection[0] === 1) { $s = 6; continue; }
			/* */ if (_selection[0] === 2) { $s = 7; continue; }
			/* */ $s = 8; continue;
			/* if (_selection[0] === 0) { */ case 5:
				connected = _selection[1][0];
				connectTimer.Stop();
				/* */ if (connected) { $s = 9; continue; }
				/* */ $s = 10; continue;
				/* if (connected) { */ case 9:
					$r = s.log(new sliceType$1([new $String("connected")])); /* */ $s = 12; case 12: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					$r = s.connState("connected"); /* */ $s = 13; case 13: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					connWorked = true;
					_r$1 = webSocketHandshake(s, ws[0]); /* */ $s = 14; case 14: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
					_tuple = _r$1; gotOnline = _tuple[0]; hostHealthy = _tuple[1];
					$s = 11; continue;
				/* } else { */ case 10:
					$r = s.log(new sliceType$1([new $String("connection failed")])); /* */ $s = 15; case 15: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				/* } */ case 11:
				$s = 8; continue;
			/* } else if (_selection[0] === 1) { */ case 6:
				$r = s.log(new sliceType$1([new $String("connection timeout")])); /* */ $s = 16; case 16: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				$s = 8; continue;
			/* } else if (_selection[0] === 2) { */ case 7:
				connectTimer.Stop();
			/* } */ case 8:
			goingAway = ws[0].GoingAway;
			ws[0].Close();
			ws[0] = ptrType$6.nil;
			/* */ if (goingAway) { $s = 17; continue; }
			/* */ $s = 18; continue;
			/* if (goingAway) { */ case 17:
				$r = s.log(new sliceType$1([new $String("disconnected (server is going away)")])); /* */ $s = 20; case 20: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				$s = 19; continue;
			/* } else { */ case 18:
				$r = s.log(new sliceType$1([new $String("disconnected")])); /* */ $s = 21; case 21: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* } */ case 19:
			if (!gotOnline || !hostHealthy || s.stopped || goingAway) {
				return [connWorked, gotOnline];
			}
		/* } */ $s = 1; continue; case 2:
		/* */ $s = -1; case -1: } return; } } catch(err) { $err = err; $s = -1; } finally { $callDeferred($deferred, $err); if (!$curGoroutine.asleep) { return  [connWorked, gotOnline]; } if($curGoroutine.asleep) { if ($f === undefined) { $f = { $blk: WebSocketTransport }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._selection = _selection; $f._tuple = _tuple; $f.connWorked = connWorked; $f.connectTimer = connectTimer; $f.connected = connected; $f.goingAway = goingAway; $f.gotOnline = gotOnline; $f.host = host; $f.hostHealthy = hostHealthy; $f.s = s; $f.ws = ws; $f.$s = $s; $f.$deferred = $deferred; $f.$r = $r; return $f; } }
	};
	$pkg.WebSocketTransport = WebSocketTransport;
	webSocketHandshake = function(s, ws) {
		var $ptr, _r, _r$1, _r$2, _r$3, _selection, _tuple, _tuple$1, connected, done, err, err$1, fail, gotEvents, gotOnline, header, header$1, hostHealthy, s, timer, ws, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _selection = $f._selection; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; connected = $f.connected; done = $f.done; err = $f.err; err$1 = $f.err$1; fail = $f.fail; gotEvents = $f.gotEvents; gotOnline = $f.gotOnline; header = $f.header; header$1 = $f.header$1; hostHealthy = $f.hostHealthy; s = $f.s; timer = $f.timer; ws = $f.ws; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		gotOnline = false;
		hostHealthy = false;
		header = null;
		/* */ if (s.sessionId === null) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (s.sessionId === null) { */ case 1:
			$r = s.log(new sliceType$1([new $String("session creation")])); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			header = s.makeCreateSessionAction();
			$s = 3; continue;
		/* } else { */ case 2:
			$r = s.log(new sliceType$1([new $String("session resumption")])); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			header = s.makeResumeSessionAction(true);
		/* } */ case 3:
		err = ws.SendJSON(new $jsObjectPtr(header));
		/* */ if (!($interfaceIsEqual(err, $ifaceNil))) { $s = 6; continue; }
		/* */ $s = 7; continue;
		/* if (!($interfaceIsEqual(err, $ifaceNil))) { */ case 6:
			$r = s.log(new sliceType$1([new $String("send:"), err])); /* */ $s = 8; case 8: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 7:
		/* */ if (s.sessionId === null) { $s = 9; continue; }
		/* */ $s = 10; continue;
		/* if (s.sessionId === null) { */ case 9:
			header$1 = null;
			timer = NewTimer(JitterDuration(new Duration(0, 13000), 0.2));
			/* while (true) { */ case 11:
				err$1 = $ifaceNil;
				_tuple = ws.ReceiveJSON(); header$1 = _tuple[0]; err$1 = _tuple[1];
				/* */ if (!($interfaceIsEqual(err$1, $ifaceNil))) { $s = 13; continue; }
				/* */ $s = 14; continue;
				/* if (!($interfaceIsEqual(err$1, $ifaceNil))) { */ case 13:
					$r = s.log(new sliceType$1([new $String("session creation:"), err$1])); /* */ $s = 15; case 15: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					return [gotOnline, hostHealthy];
				/* } */ case 14:
				if (!(header$1 === null)) {
					timer.Stop();
					/* break; */ $s = 12; continue;
				}
				_r = $select([[ws.Notify], [timer.C]]); /* */ $s = 16; case 16: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				_selection = _r;
				/* */ if (_selection[0] === 0) { $s = 17; continue; }
				/* */ if (_selection[0] === 1) { $s = 18; continue; }
				/* */ $s = 19; continue;
				/* if (_selection[0] === 0) { */ case 17:
					connected = _selection[1][0];
					/* */ if (!connected) { $s = 20; continue; }
					/* */ $s = 21; continue;
					/* if (!connected) { */ case 20:
						$r = s.log(new sliceType$1([new $String("disconnected during session creation")])); /* */ $s = 22; case 22: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
						timer.Stop();
						return [gotOnline, hostHealthy];
					/* } */ case 21:
					$s = 19; continue;
				/* } else if (_selection[0] === 1) { */ case 18:
					$r = s.log(new sliceType$1([new $String("session creation timeout")])); /* */ $s = 23; case 23: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					return [gotOnline, hostHealthy];
				/* } */ case 19:
			/* } */ $s = 11; continue; case 12:
			_r$1 = s.handleSessionEvent(header$1); /* */ $s = 26; case 26: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			/* */ if (!_r$1) { $s = 24; continue; }
			/* */ $s = 25; continue;
			/* if (!_r$1) { */ case 24:
				return [gotOnline, hostHealthy];
			/* } */ case 25:
			gotOnline = true;
			hostHealthy = true;
			$r = s.connActive(); /* */ $s = 27; case 27: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 10:
		fail = new chanType$1(1);
		done = new chanType$1(0);
		$go(webSocketSend, [s, ws, fail, done]);
		_r$2 = webSocketReceive(s, ws, fail); /* */ $s = 28; case 28: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		_tuple$1 = _r$2; gotEvents = _tuple$1[0]; hostHealthy = _tuple$1[1];
		if (gotEvents) {
			gotOnline = true;
		}
		_r$3 = $recv(done); /* */ $s = 29; case 29: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
		_r$3[0];
		return [gotOnline, hostHealthy];
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: webSocketHandshake }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._selection = _selection; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f.connected = connected; $f.done = done; $f.err = err; $f.err$1 = err$1; $f.fail = fail; $f.gotEvents = gotEvents; $f.gotOnline = gotOnline; $f.header = header; $f.header$1 = header$1; $f.hostHealthy = hostHealthy; $f.s = s; $f.timer = timer; $f.ws = ws; $f.$s = $s; $f.$r = $r; return $f;
	};
	webSocketSend = function(s, ws, fail, done) {
		var $ptr, _key, _map, _r, _selection, _tuple, _tuple$1, _tuple$2, action, action$1, array, base64, buffer, closeSession, data, done, err, err$1, err$2, err$3, err$4, err$5, fail, frame, i, i$1, keeper, length, ok, s, sending, ws, x, x$1, x$2, x$3, x$4, x$5, x$6, $s, $deferred, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _key = $f._key; _map = $f._map; _r = $f._r; _selection = $f._selection; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; _tuple$2 = $f._tuple$2; action = $f.action; action$1 = $f.action$1; array = $f.array; base64 = $f.base64; buffer = $f.buffer; closeSession = $f.closeSession; data = $f.data; done = $f.done; err = $f.err; err$1 = $f.err$1; err$2 = $f.err$2; err$3 = $f.err$3; err$4 = $f.err$4; err$5 = $f.err$5; fail = $f.fail; frame = $f.frame; i = $f.i; i$1 = $f.i$1; keeper = $f.keeper; length = $f.length; ok = $f.ok; s = $f.s; sending = $f.sending; ws = $f.ws; x = $f.x; x$1 = $f.x$1; x$2 = $f.x$2; x$3 = $f.x$3; x$4 = $f.x$4; x$5 = $f.x$5; x$6 = $f.x$6; $s = $f.$s; $deferred = $f.$deferred; $r = $f.$r; } var $err = null; try { s: while (true) { switch ($s) { case 0: $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		done = [done];
		$deferred.push([(function(done) { return function $b() {
			var $ptr, $s, $r;
			/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
			$r = $send(done[0], true); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f.$s = $s; $f.$r = $r; return $f;
		}; })(done), []]);
		keeper = NewTimer(JitterDuration(new Duration(0, 56000), -0.3));
		$deferred.push([$methodVal(keeper, "Stop"), []]);
		s.numSent = 0;
		/* while (true) { */ case 1:
			/* while (true) { */ case 3:
				/* if (!(s.numSent < s.sendBuffer.$length)) { break; } */ if(!(s.numSent < s.sendBuffer.$length)) { $s = 4; continue; }
				action = (x = s.sendBuffer, x$1 = s.numSent, ((x$1 < 0 || x$1 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + x$1]));
				if (!(action.Payload === null)) {
					action.Header.frames = $parseInt(action.Payload.length);
				}
				if (!((x$2 = s.receivedEventId, x$3 = s.ackedEventId, (x$2.$high === x$3.$high && x$2.$low === x$3.$low)))) {
					action.Header.event_id = $externalize(s.receivedEventId, $Uint64);
					s.sendEventAck = false;
					s.ackedEventId = s.receivedEventId;
				}
				err = ws.SendJSON(new $jsObjectPtr(action.Header));
				delete action.Header[$externalize("frames", $String)];
				delete action.Header[$externalize("event_id", $String)];
				/* */ if (!($interfaceIsEqual(err, $ifaceNil))) { $s = 5; continue; }
				/* */ $s = 6; continue;
				/* if (!($interfaceIsEqual(err, $ifaceNil))) { */ case 5:
					$r = s.log(new sliceType$1([new $String("send:"), err])); /* */ $s = 7; case 7: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					$r = $send(fail, true); /* */ $s = 8; case 8: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					return;
				/* } */ case 6:
				/* */ if (!(action.Payload === null)) { $s = 9; continue; }
				/* */ $s = 10; continue;
				/* if (!(action.Payload === null)) { */ case 9:
					i = 0;
					/* while (true) { */ case 11:
						/* if (!(i < $parseInt(action.Payload.length))) { break; } */ if(!(i < $parseInt(action.Payload.length))) { $s = 12; continue; }
						frame = action.Payload[i];
						/* */ if ($internalize(action.Header.action, $String) === "update_user") { $s = 13; continue; }
						/* */ $s = 14; continue;
						/* if ($internalize(action.Header.action, $String) === "update_user") { */ case 13:
							_tuple = $assertType($internalize(frame, $emptyInterface), $String, true); ok = _tuple[1];
							/* */ if (ok) { $s = 15; continue; }
							/* */ $s = 16; continue;
							/* if (ok) { */ case 15:
								_tuple$1 = ParseDataURI(frame); base64 = _tuple$1[0]; err$1 = _tuple$1[1];
								/* */ if (!($interfaceIsEqual(err$1, $ifaceNil))) { $s = 17; continue; }
								/* */ $s = 18; continue;
								/* if (!($interfaceIsEqual(err$1, $ifaceNil))) { */ case 17:
									$r = s.log(new sliceType$1([new $String("send:"), err$1])); /* */ $s = 19; case 19: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
									$r = $send(fail, true); /* */ $s = 20; case 20: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
									return;
								/* } */ case 18:
								_tuple$2 = Atob(base64); data = _tuple$2[0]; err$1 = _tuple$2[1];
								/* */ if (!($interfaceIsEqual(err$1, $ifaceNil))) { $s = 21; continue; }
								/* */ $s = 22; continue;
								/* if (!($interfaceIsEqual(err$1, $ifaceNil))) { */ case 21:
									$r = s.log(new sliceType$1([new $String("send:"), err$1])); /* */ $s = 23; case 23: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
									$r = $send(fail, true); /* */ $s = 24; case 24: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
									return;
								/* } */ case 22:
								length = $parseInt(data.length);
								buffer = NewArrayBuffer(length);
								array = NewUint8Array(buffer);
								i$1 = 0;
								while (true) {
									if (!(i$1 < length)) { break; }
									array[i$1] = data.charCodeAt(i$1);
									i$1 = i$1 + (1) >> 0;
								}
								frame = buffer;
							/* } */ case 16:
						/* } */ case 14:
						err$2 = ws.Send(new $jsObjectPtr(frame));
						/* */ if (!($interfaceIsEqual(err$2, $ifaceNil))) { $s = 25; continue; }
						/* */ $s = 26; continue;
						/* if (!($interfaceIsEqual(err$2, $ifaceNil))) { */ case 25:
							$r = s.log(new sliceType$1([new $String("send:"), err$2])); /* */ $s = 27; case 27: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
							$r = $send(fail, true); /* */ $s = 28; case 28: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
							return;
						/* } */ case 26:
						i = i + (1) >> 0;
					/* } */ $s = 11; continue; case 12:
				/* } */ case 10:
				if ((x$4 = action.Id, (x$4.$high === 0 && x$4.$low === 0))) {
					s.sendBuffer = $appendSlice($subslice(s.sendBuffer, 0, s.numSent), $subslice(s.sendBuffer, (s.numSent + 1 >> 0)));
				} else {
					s.numSent = s.numSent + (1) >> 0;
				}
				keeper.Reset(JitterDuration(new Duration(0, 56000), -0.3));
			/* } */ $s = 3; continue; case 4:
			/* */ if (s.sendEventAck && !((x$5 = s.receivedEventId, x$6 = s.ackedEventId, (x$5.$high === x$6.$high && x$5.$low === x$6.$low)))) { $s = 29; continue; }
			/* */ $s = 30; continue;
			/* if (s.sendEventAck && !((x$5 = s.receivedEventId, x$6 = s.ackedEventId, (x$5.$high === x$6.$high && x$5.$low === x$6.$low)))) { */ case 29:
				action$1 = s.makeResumeSessionAction(false);
				err$3 = ws.SendJSON(new $jsObjectPtr(action$1));
				/* */ if (!($interfaceIsEqual(err$3, $ifaceNil))) { $s = 31; continue; }
				/* */ $s = 32; continue;
				/* if (!($interfaceIsEqual(err$3, $ifaceNil))) { */ case 31:
					$r = s.log(new sliceType$1([new $String("send:"), err$3])); /* */ $s = 33; case 33: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					$r = $send(fail, true); /* */ $s = 34; case 34: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					return;
				/* } */ case 32:
			/* } */ case 30:
			_r = $select([[s.sendNotify], [keeper.C], [fail]]); /* */ $s = 35; case 35: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			_selection = _r;
			/* */ if (_selection[0] === 0) { $s = 36; continue; }
			/* */ if (_selection[0] === 1) { $s = 37; continue; }
			/* */ if (_selection[0] === 2) { $s = 38; continue; }
			/* */ $s = 39; continue;
			/* if (_selection[0] === 0) { */ case 36:
				sending = _selection[1][0];
				/* */ if (!sending) { $s = 40; continue; }
				/* */ $s = 41; continue;
				/* if (!sending) { */ case 40:
					closeSession = (_map = new $Map(), _key = "action", _map[_key] = { k: _key, v: new $String("close_session") }, _map);
					err$4 = ws.SendJSON(new mapType(closeSession));
					/* */ if (!($interfaceIsEqual(err$4, $ifaceNil))) { $s = 42; continue; }
					/* */ $s = 43; continue;
					/* if (!($interfaceIsEqual(err$4, $ifaceNil))) { */ case 42:
						$r = s.log(new sliceType$1([new $String("send:"), err$4])); /* */ $s = 44; case 44: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					/* } */ case 43:
					return;
				/* } */ case 41:
				$s = 39; continue;
			/* } else if (_selection[0] === 1) { */ case 37:
				err$5 = ws.Send(new sliceType$4([]));
				/* */ if (!($interfaceIsEqual(err$5, $ifaceNil))) { $s = 45; continue; }
				/* */ $s = 46; continue;
				/* if (!($interfaceIsEqual(err$5, $ifaceNil))) { */ case 45:
					$r = s.log(new sliceType$1([new $String("send:"), err$5])); /* */ $s = 47; case 47: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					$r = $send(fail, true); /* */ $s = 48; case 48: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					return;
				/* } */ case 46:
				keeper.Reset(JitterDuration(new Duration(0, 56000), -0.3));
				$s = 39; continue;
			/* } else if (_selection[0] === 2) { */ case 38:
				return;
			/* } */ case 39:
		/* } */ $s = 1; continue; case 2:
		/* */ $s = -1; case -1: } return; } } catch(err) { $err = err; $s = -1; } finally { $callDeferred($deferred, $err); if($curGoroutine.asleep) { if ($f === undefined) { $f = { $blk: webSocketSend }; } $f.$ptr = $ptr; $f._key = _key; $f._map = _map; $f._r = _r; $f._selection = _selection; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f._tuple$2 = _tuple$2; $f.action = action; $f.action$1 = action$1; $f.array = array; $f.base64 = base64; $f.buffer = buffer; $f.closeSession = closeSession; $f.data = data; $f.done = done; $f.err = err; $f.err$1 = err$1; $f.err$2 = err$2; $f.err$3 = err$3; $f.err$4 = err$4; $f.err$5 = err$5; $f.fail = fail; $f.frame = frame; $f.i = i; $f.i$1 = i$1; $f.keeper = keeper; $f.length = length; $f.ok = ok; $f.s = s; $f.sending = sending; $f.ws = ws; $f.x = x; $f.x$1 = x$1; $f.x$2 = x$2; $f.x$3 = x$3; $f.x$4 = x$4; $f.x$5 = x$5; $f.x$6 = x$6; $f.$s = $s; $f.$deferred = $deferred; $f.$r = $r; return $f; } }
	};
	webSocketReceive = function(s, ws, fail) {
		var $ptr, _r, _r$1, _selection, _selection$1, _tuple, _tuple$1, _tuple$2, _tuple$3, _tuple$4, ackNeeded, acker, connected, data, data$1, err, err$1, fail, frames, gotEvents, header, hostHealthy, needsAck, ok, payload, s, sessionLost, text, watchdog, ws, x, x$1, $s, $deferred, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _selection = $f._selection; _selection$1 = $f._selection$1; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; _tuple$2 = $f._tuple$2; _tuple$3 = $f._tuple$3; _tuple$4 = $f._tuple$4; ackNeeded = $f.ackNeeded; acker = $f.acker; connected = $f.connected; data = $f.data; data$1 = $f.data$1; err = $f.err; err$1 = $f.err$1; fail = $f.fail; frames = $f.frames; gotEvents = $f.gotEvents; header = $f.header; hostHealthy = $f.hostHealthy; needsAck = $f.needsAck; ok = $f.ok; payload = $f.payload; s = $f.s; sessionLost = $f.sessionLost; text = $f.text; watchdog = $f.watchdog; ws = $f.ws; x = $f.x; x$1 = $f.x$1; $s = $f.$s; $deferred = $f.$deferred; $r = $f.$r; } var $err = null; try { s: while (true) { switch ($s) { case 0: $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		gotEvents = false;
		hostHealthy = false;
		header = null;
		payload = null;
		frames = 0;
		watchdog = NewTimer(JitterDuration(new Duration(0, 64000), 0.3));
		$deferred.push([$methodVal(watchdog, "Stop"), []]);
		acker = NewTimer(new Duration(-1, 4294967295));
		$deferred.push([$methodVal(acker, "Stop"), []]);
		/* while (true) { */ case 1:
			ackNeeded = false;
			/* while (true) { */ case 3:
				/* */ if (header === null) { $s = 5; continue; }
				/* */ $s = 6; continue;
				/* if (header === null) { */ case 5:
					err = $ifaceNil;
					_tuple = ws.Receive(); data = _tuple[0]; err = _tuple[1];
					/* */ if (!($interfaceIsEqual(err, $ifaceNil))) { $s = 8; continue; }
					/* */ $s = 9; continue;
					/* if (!($interfaceIsEqual(err, $ifaceNil))) { */ case 8:
						$r = s.log(new sliceType$1([new $String("receive:"), err])); /* */ $s = 10; case 10: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
						hostHealthy = false;
						$r = $send(fail, true); /* */ $s = 11; case 11: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
						return [gotEvents, hostHealthy];
					/* } */ case 9:
					if (data === null) {
						/* break; */ $s = 4; continue;
					}
					watchdog.Reset(JitterDuration(new Duration(0, 64000), 0.7));
					$r = s.connActive(); /* */ $s = 12; case 12: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					text = StringifyFrame(data);
					/* */ if (text.length === 0) { $s = 13; continue; }
					/* */ $s = 14; continue;
					/* if (text.length === 0) { */ case 13:
						/* continue; */ $s = 3; continue;
					/* } */ case 14:
					_tuple$1 = ParseJSON(text); header = _tuple$1[0]; err = _tuple$1[1];
					/* */ if (!($interfaceIsEqual(err, $ifaceNil))) { $s = 15; continue; }
					/* */ $s = 16; continue;
					/* if (!($interfaceIsEqual(err, $ifaceNil))) { */ case 15:
						$r = s.log(new sliceType$1([new $String("receive:"), err])); /* */ $s = 17; case 17: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
						hostHealthy = false;
						$r = $send(fail, true); /* */ $s = 18; case 18: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
						return [gotEvents, hostHealthy];
					/* } */ case 16:
					payload = NewArray();
					_tuple$2 = GetEventFrames(header); frames = _tuple$2[0]; err = _tuple$2[1];
					/* */ if (!($interfaceIsEqual(err, $ifaceNil))) { $s = 19; continue; }
					/* */ $s = 20; continue;
					/* if (!($interfaceIsEqual(err, $ifaceNil))) { */ case 19:
						$r = s.log(new sliceType$1([new $String("receive:"), err])); /* */ $s = 21; case 21: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
						hostHealthy = false;
						$r = $send(fail, true); /* */ $s = 22; case 22: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
						return [gotEvents, hostHealthy];
					/* } */ case 20:
					$s = 7; continue;
				/* } else { */ case 6:
					_tuple$3 = ws.Receive(); data$1 = _tuple$3[0]; err$1 = _tuple$3[1];
					/* */ if (!($interfaceIsEqual(err$1, $ifaceNil))) { $s = 23; continue; }
					/* */ $s = 24; continue;
					/* if (!($interfaceIsEqual(err$1, $ifaceNil))) { */ case 23:
						$r = s.log(new sliceType$1([new $String("receive:"), err$1])); /* */ $s = 25; case 25: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
						hostHealthy = false;
						$r = $send(fail, true); /* */ $s = 26; case 26: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
						return [gotEvents, hostHealthy];
					/* } */ case 24:
					if (data$1 === null) {
						/* break; */ $s = 4; continue;
					}
					payload.push(data$1);
					frames = frames - (1) >> 0;
				/* } */ case 7:
				/* */ if (frames === 0) { $s = 27; continue; }
				/* */ $s = 28; continue;
				/* if (frames === 0) { */ case 27:
					_r = s.handleEvent(header, payload); /* */ $s = 29; case 29: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
					_tuple$4 = _r; sessionLost = _tuple$4[1]; needsAck = _tuple$4[2]; ok = _tuple$4[3];
					/* */ if (!ok) { $s = 30; continue; }
					/* */ $s = 31; continue;
					/* if (!ok) { */ case 30:
						if (sessionLost) {
							gotEvents = true;
						} else {
							hostHealthy = false;
						}
						$r = $send(fail, true); /* */ $s = 32; case 32: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
						return [gotEvents, hostHealthy];
					/* } */ case 31:
					if (needsAck) {
						ackNeeded = true;
					}
					header = null;
					payload = null;
					frames = 0;
					gotEvents = true;
					hostHealthy = true;
				/* } */ case 28:
				_selection = $select([[s.closeNotify], [fail], []]);
				if (_selection[0] === 0) {
					return [gotEvents, hostHealthy];
				} else if (_selection[0] === 1) {
					return [gotEvents, hostHealthy];
				}
			/* } */ $s = 3; continue; case 4:
			if (ackNeeded && !acker.Active()) {
				acker.Reset(JitterDuration(new Duration(0, 7000), -0.3));
			}
			_r$1 = $select([[ws.Notify], [watchdog.C], [acker.C], [s.closeNotify], [fail]]); /* */ $s = 33; case 33: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			_selection$1 = _r$1;
			/* */ if (_selection$1[0] === 0) { $s = 34; continue; }
			/* */ if (_selection$1[0] === 1) { $s = 35; continue; }
			/* */ if (_selection$1[0] === 2) { $s = 36; continue; }
			/* */ if (_selection$1[0] === 3) { $s = 37; continue; }
			/* */ if (_selection$1[0] === 4) { $s = 38; continue; }
			/* */ $s = 39; continue;
			/* if (_selection$1[0] === 0) { */ case 34:
				connected = _selection$1[1][0];
				/* */ if (!connected) { $s = 40; continue; }
				/* */ $s = 41; continue;
				/* if (!connected) { */ case 40:
					$r = $send(fail, true); /* */ $s = 42; case 42: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					return [gotEvents, hostHealthy];
				/* } */ case 41:
				$s = 39; continue;
			/* } else if (_selection$1[0] === 1) { */ case 35:
				$r = s.log(new sliceType$1([new $String("receive timeout")])); /* */ $s = 43; case 43: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				$r = $send(fail, true); /* */ $s = 44; case 44: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				return [gotEvents, hostHealthy];
				$s = 39; continue;
			/* } else if (_selection$1[0] === 2) { */ case 36:
				if (!s.sendEventAck && !((x = s.ackedEventId, x$1 = s.receivedEventId, (x.$high === x$1.$high && x.$low === x$1.$low)))) {
					s.sendAck();
				}
				$s = 39; continue;
			/* } else if (_selection$1[0] === 3) { */ case 37:
				return [gotEvents, hostHealthy];
				$s = 39; continue;
			/* } else if (_selection$1[0] === 4) { */ case 38:
				return [gotEvents, hostHealthy];
			/* } */ case 39:
		/* } */ $s = 1; continue; case 2:
		/* */ $s = -1; case -1: } return; } } catch(err) { $err = err; $s = -1; } finally { $callDeferred($deferred, $err); if (!$curGoroutine.asleep) { return  [gotEvents, hostHealthy]; } if($curGoroutine.asleep) { if ($f === undefined) { $f = { $blk: webSocketReceive }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._selection = _selection; $f._selection$1 = _selection$1; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f._tuple$2 = _tuple$2; $f._tuple$3 = _tuple$3; $f._tuple$4 = _tuple$4; $f.ackNeeded = ackNeeded; $f.acker = acker; $f.connected = connected; $f.data = data; $f.data$1 = data$1; $f.err = err; $f.err$1 = err$1; $f.fail = fail; $f.frames = frames; $f.gotEvents = gotEvents; $f.header = header; $f.hostHealthy = hostHealthy; $f.needsAck = needsAck; $f.ok = ok; $f.payload = payload; $f.s = s; $f.sessionLost = sessionLost; $f.text = text; $f.watchdog = watchdog; $f.ws = ws; $f.x = x; $f.x$1 = x$1; $f.$s = $s; $f.$deferred = $deferred; $f.$r = $r; return $f; } }
	};
	init = function() {
		var $ptr;
		xhrType = $global.XDomainRequest;
		if (xhrType === undefined) {
			xhrType = $global.XMLHttpRequest;
			xhrRequestHeaderSupport = true;
		}
	};
	XHR = function(url, data, timeout) {
		var $ptr, channel, data, err, method, request, timeout, url, $deferred;
		/* */ var $err = null; try { $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		channel = chanType$2.nil;
		err = $ifaceNil;
		$deferred.push([(function() {
			var $ptr;
			err = jsError($recover());
		}), []]);
		method = "";
		if (data === "") {
			method = "GET";
		} else {
			method = "POST";
		}
		channel = new chanType$2(1);
		request = new (xhrType)();
		request.onload = $externalize((function() {
			var $ptr, obj, response;
			response = "";
			obj = request.responseText;
			if (!(obj === undefined) && !(obj === null)) {
				response = $internalize(obj, $String);
			}
			$go((function $b() {
				var $ptr, $s, $r;
				/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
				$r = $send(channel, response); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f.$s = $s; $f.$r = $r; return $f;
			}), []);
		}), funcType);
		request.onprogress = $externalize((function() {
			var $ptr;
		}), funcType);
		request.ontimeout = $externalize((function() {
			var $ptr;
			$go((function() {
				var $ptr;
				$close(channel);
			}), []);
		}), funcType);
		request.onerror = $externalize((function() {
			var $ptr;
			$go((function $b() {
				var $ptr, $s, $r;
				/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
				$r = $send(channel, ""); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f.$s = $s; $f.$r = $r; return $f;
			}), []);
		}), funcType);
		request.open($externalize(method, $String), $externalize(url, $String));
		request.timeout = $externalize(timeout, Duration);
		if (!(data === "") && xhrRequestHeaderSupport) {
			request.setRequestHeader($externalize("Content-Type", $String), $externalize("application/json", $String));
		}
		request.send($externalize(data, $String));
		return [channel, err];
		/* */ } catch(err) { $err = err; } finally { $callDeferred($deferred, $err); if (!$curGoroutine.asleep) { return  [channel, err]; } }
	};
	$pkg.XHR = XHR;
	XHR_JSON = function(url, data, timeout) {
		var $ptr, _tuple, _tuple$1, channel, data, err, json, timeout, url;
		channel = chanType$2.nil;
		err = $ifaceNil;
		_tuple = StringifyJSON(data); json = _tuple[0]; err = _tuple[1];
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			return [channel, err];
		}
		_tuple$1 = XHR(url, json, timeout); channel = _tuple$1[0]; err = _tuple$1[1];
		return [channel, err];
	};
	$pkg.XHR_JSON = XHR_JSON;
	ptrType$4.methods = [{prop: "Name", name: "Name", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$7.methods = [{prop: "Success", name: "Success", pkg: "", typ: $funcType([], [], false)}, {prop: "Failure", name: "Failure", pkg: "", typ: $funcType([Duration], [Duration], false)}];
	ptrType$3.methods = [{prop: "then", name: "then", pkg: "ninchatclient", typ: $funcType([ptrType$2, ptrType$2, ptrType$2], [], false)}, {prop: "Resolve", name: "Resolve", pkg: "", typ: $funcType([sliceType$1], [], true)}, {prop: "Reject", name: "Reject", pkg: "", typ: $funcType([sliceType$1], [], true)}, {prop: "Notify", name: "Notify", pkg: "", typ: $funcType([sliceType$1], [], true)}];
	ptrType$8.methods = [{prop: "OnSessionEvent", name: "OnSessionEvent", pkg: "", typ: $funcType([ptrType$2], [], false)}, {prop: "OnEvent", name: "OnEvent", pkg: "", typ: $funcType([ptrType$2], [], false)}, {prop: "OnConnState", name: "OnConnState", pkg: "", typ: $funcType([ptrType$2], [], false)}, {prop: "OnConnActive", name: "OnConnActive", pkg: "", typ: $funcType([ptrType$2], [], false)}, {prop: "OnLog", name: "OnLog", pkg: "", typ: $funcType([ptrType$2], [], false)}, {prop: "SetParams", name: "SetParams", pkg: "", typ: $funcType([mapType$1], [], false)}, {prop: "SetTransport", name: "SetTransport", pkg: "", typ: $funcType([ptrType$2], [], false)}, {prop: "SetAddress", name: "SetAddress", pkg: "", typ: $funcType([ptrType$2], [], false)}, {prop: "Open", name: "Open", pkg: "", typ: $funcType([], [], false)}, {prop: "Close", name: "Close", pkg: "", typ: $funcType([], [], false)}, {prop: "Send", name: "Send", pkg: "", typ: $funcType([ptrType$2, ptrType$2], [$emptyInterface], false)}, {prop: "send", name: "send", pkg: "ninchatclient", typ: $funcType([ptrType$4], [], false)}, {prop: "sendAck", name: "sendAck", pkg: "ninchatclient", typ: $funcType([], [], false)}, {prop: "discover", name: "discover", pkg: "ninchatclient", typ: $funcType([], [], false)}, {prop: "connect", name: "connect", pkg: "ninchatclient", typ: $funcType([Transport, sliceType, ptrType$7], [$Bool], false)}, {prop: "canLogin", name: "canLogin", pkg: "ninchatclient", typ: $funcType([], [$Bool], false)}, {prop: "makeCreateSessionAction", name: "makeCreateSessionAction", pkg: "ninchatclient", typ: $funcType([], [ptrType$2], false)}, {prop: "makeResumeSessionAction", name: "makeResumeSessionAction", pkg: "ninchatclient", typ: $funcType([$Bool], [ptrType$2], false)}, {prop: "handleSessionEvent", name: "handleSessionEvent", pkg: "ninchatclient", typ: $funcType([ptrType$2], [$Bool], false)}, {prop: "handleEvent", name: "handleEvent", pkg: "ninchatclient", typ: $funcType([ptrType$2, ptrType$2], [$Uint64, $Bool, $Bool, $Bool], false)}, {prop: "connState", name: "connState", pkg: "ninchatclient", typ: $funcType([$String], [], false)}, {prop: "connActive", name: "connActive", pkg: "ninchatclient", typ: $funcType([], [], false)}, {prop: "log", name: "log", pkg: "ninchatclient", typ: $funcType([sliceType$1], [], true)}];
	ptrType$5.methods = [{prop: "Active", name: "Active", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "Reset", name: "Reset", pkg: "", typ: $funcType([Duration], [], false)}, {prop: "Stop", name: "Stop", pkg: "", typ: $funcType([], [], false)}];
	ptrType$6.methods = [{prop: "Send", name: "Send", pkg: "", typ: $funcType([$emptyInterface], [$error], false)}, {prop: "SendJSON", name: "SendJSON", pkg: "", typ: $funcType([$emptyInterface], [$error], false)}, {prop: "Receive", name: "Receive", pkg: "", typ: $funcType([], [ptrType$2, $error], false)}, {prop: "ReceiveJSON", name: "ReceiveJSON", pkg: "", typ: $funcType([], [ptrType$2, $error], false)}, {prop: "Close", name: "Close", pkg: "", typ: $funcType([], [$error], false)}];
	Action.init([{prop: "Id", name: "Id", pkg: "", typ: $Uint64, tag: ""}, {prop: "Header", name: "Header", pkg: "", typ: ptrType$2, tag: ""}, {prop: "Payload", name: "Payload", pkg: "", typ: ptrType$2, tag: ""}, {prop: "Deferred", name: "Deferred", pkg: "", typ: ptrType$3, tag: ""}, {prop: "name", name: "name", pkg: "ninchatclient", typ: $String, tag: ""}]);
	Backoff.init([{prop: "lastSlot", name: "lastSlot", pkg: "ninchatclient", typ: $Int, tag: ""}]);
	Deferred.init([{prop: "resolve", name: "resolve", pkg: "ninchatclient", typ: sliceType$2, tag: ""}, {prop: "reject", name: "reject", pkg: "ninchatclient", typ: sliceType$2, tag: ""}, {prop: "notify", name: "notify", pkg: "ninchatclient", typ: sliceType$2, tag: ""}]);
	Transport.init([ptrType$8, $String], [$Bool, $Bool], false);
	Session.init([{prop: "onSessionEvent", name: "onSessionEvent", pkg: "ninchatclient", typ: ptrType$2, tag: ""}, {prop: "onEvent", name: "onEvent", pkg: "ninchatclient", typ: ptrType$2, tag: ""}, {prop: "onConnState", name: "onConnState", pkg: "ninchatclient", typ: ptrType$2, tag: ""}, {prop: "onConnActive", name: "onConnActive", pkg: "ninchatclient", typ: ptrType$2, tag: ""}, {prop: "onLog", name: "onLog", pkg: "ninchatclient", typ: ptrType$2, tag: ""}, {prop: "address", name: "address", pkg: "ninchatclient", typ: $String, tag: ""}, {prop: "forceLongPoll", name: "forceLongPoll", pkg: "ninchatclient", typ: $Bool, tag: ""}, {prop: "sessionParams", name: "sessionParams", pkg: "ninchatclient", typ: mapType$1, tag: ""}, {prop: "sessionId", name: "sessionId", pkg: "ninchatclient", typ: ptrType$2, tag: ""}, {prop: "latestConnState", name: "latestConnState", pkg: "ninchatclient", typ: $String, tag: ""}, {prop: "latestConnActive", name: "latestConnActive", pkg: "ninchatclient", typ: Time, tag: ""}, {prop: "lastActionId", name: "lastActionId", pkg: "ninchatclient", typ: $Uint64, tag: ""}, {prop: "sendNotify", name: "sendNotify", pkg: "ninchatclient", typ: chanType$1, tag: ""}, {prop: "sendBuffer", name: "sendBuffer", pkg: "ninchatclient", typ: sliceType$3, tag: ""}, {prop: "numSent", name: "numSent", pkg: "ninchatclient", typ: $Int, tag: ""}, {prop: "sendEventAck", name: "sendEventAck", pkg: "ninchatclient", typ: $Bool, tag: ""}, {prop: "receivedEventId", name: "receivedEventId", pkg: "ninchatclient", typ: $Uint64, tag: ""}, {prop: "ackedEventId", name: "ackedEventId", pkg: "ninchatclient", typ: $Uint64, tag: ""}, {prop: "closeNotify", name: "closeNotify", pkg: "ninchatclient", typ: chanType$1, tag: ""}, {prop: "closed", name: "closed", pkg: "ninchatclient", typ: $Bool, tag: ""}, {prop: "stopped", name: "stopped", pkg: "ninchatclient", typ: $Bool, tag: ""}]);
	Timer.init([{prop: "C", name: "C", pkg: "", typ: chanType$1, tag: ""}, {prop: "id", name: "id", pkg: "ninchatclient", typ: ptrType$2, tag: ""}]);
	WebSocket.init([{prop: "Notify", name: "Notify", pkg: "", typ: chanType$1, tag: ""}, {prop: "GoingAway", name: "GoingAway", pkg: "", typ: $Bool, tag: ""}, {prop: "impl", name: "impl", pkg: "ninchatclient", typ: ptrType$2, tag: ""}, {prop: "open", name: "open", pkg: "ninchatclient", typ: $Bool, tag: ""}, {prop: "error", name: "error", pkg: "ninchatclient", typ: $error, tag: ""}, {prop: "buffer", name: "buffer", pkg: "ninchatclient", typ: sliceType$2, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = errors.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = js.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = sort.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		xhrType = null;
		xhrRequestHeaderSupport = false;
		module = NewObject();
		sessionEventAckWindow = JitterUint64(new $Uint64(0, 4096), -0.25);
		$pkg.WebSocketSupported = !($global.WebSocket === undefined);
		init();
		main();
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$synthesizeMethods();
$packages["runtime"].$init();
$go($packages["ninchatclient"].$init, [], true);
$flushConsole();

}).call(this);
//# sourceMappingURL=ninchatclient.js.map
