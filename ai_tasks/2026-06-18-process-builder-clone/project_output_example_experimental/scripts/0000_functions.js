/* eslint-disable @typescript-eslint/no-unused-vars */

// ----------------------------
// Arrays
// ----------------------------

function arraySome(arr, fn) {
    for (var i = 0; i < arr.length; i++) {
        if (fn(arr[i], i, arr)) {
            return true;
        }
    }
    return false;
}

function arrayMap(arr, fn) {
    var mapped = [];
    for (var i = 0; i < arr.length; i++) {
        mapped.push(fn(arr[i], i, arr));
    }
    return mapped;
}

function arrayForEach(arr, fn) {
    for (var i = 0; i < arr.length; i++) {
        fn(arr[i], i, arr);
    }
}

function arrayFilter(arr, fn) {
    var filtered = [];
    for (var i = 0; i < arr.length; i++) {
        if (fn(arr[i], i, arr)) {
            filtered.push(arr[i]);
        }
    }
    return filtered;
}

function arrayFind(arr, fn) {
    for (var i = 0; i < arr.length; i++) {
        if (fn(arr[i], i, arr)) {
            return arr[i];
        }
    }
    return undefined;
}

function arrayFindIndex(arr, fn) {
    for (var i = 0; i < arr.length; i++) {
        if (fn(arr[i], i, arr)) {
            return i;
        }
    }
    return -1;
}

function arrayDedupe(arr, compare) {
    return arrayFilter(arr, function (item, index, self) {
        return (
            index ===
            arrayFindIndex(self, function (otherItem) {
                if (compare) {
                    return compare(item, otherItem);
                }
                return item === otherItem;
            })
        );
    });
}

function arrayReduce(arr, fn, initialValue) {
    var accumulator = initialValue;
    var startIndex = 0;

    if (accumulator === undefined) {
        if (arr.length === 0) {
            throw new TypeError('Reduce of empty array with no initial value');
        }
        accumulator = arr[0];
        startIndex = 1;
    }

    for (var i = startIndex; i < arr.length; i++) {
        accumulator = fn(accumulator, arr[i], i, arr);
    }

    return accumulator;
}

function arrayIncludes(arr, value) {
    for (var i = 0; i < arr.length; i++) {
        if (arr[i] === value) {
            return true;
        }
    }
    return false;
}

// ----------------------------
// Dates
// ----------------------------

function pad(number, width, paddingCharacter) {
    paddingCharacter = paddingCharacter || '0';
    number = number + ''; // Convert to string
    return number.length >= width
        ? number
        : new Array(width - number.length + 1).join(paddingCharacter) + number;
}

function formatDateES5(d) {
    var year = d.getFullYear();
    var month = d.getMonth() + 1; // Month is 0-indexed
    var day = d.getDate();

    var paddedMonth = pad(month, 2, '0');
    var paddedDay = pad(day, 2, '0');

    return year + '-' + paddedMonth + '-' + paddedDay;
}

// ----------------------------
// Objects
// ----------------------------

function safeGet(obj, path, defaultValue) {
    if (obj == null || typeof path !== 'string') {
        return defaultValue !== undefined ? defaultValue : undefined;
    }

    var keys = path.split('.');
    var current = obj;

    for (var i = 0; i < keys.length; i++) {
        if (current == null || typeof current !== 'object') {
            return defaultValue !== undefined ? defaultValue : undefined;
        }

        current = current[keys[i]];
    }

    return current !== undefined ? current : defaultValue !== undefined ? defaultValue : undefined;
}
