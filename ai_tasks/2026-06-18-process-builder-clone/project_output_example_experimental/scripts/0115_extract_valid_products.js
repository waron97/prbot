try {
    // ----------------------------
    // Input gathering
    // ----------------------------

    var jsonResponse = JSON.parse(execution.getVariable('filteredListsResponse'));

    var currentOptions = JSON.parse(execution.getVariable('productOptions'));

    // ----------------------------
    // Output variable initialization
    // ----------------------------

    var validProductIds;
    var productOptions = currentOptions;

    // ----------------------------
    // Logical Helpers
    // ----------------------------

    function arrayFilter(arr, fn) {
        var filtered = [];
        for (var i = 0; i < arr.length; i++) {
            if (fn(arr[i], i, arr)) {
                filtered.push(arr[i]);
            }
        }
        return filtered;
    }

    function arrayMap(arr, fn) {
        var mapped = [];
        for (var i = 0; i < arr.length; i++) {
            mapped.push(fn(arr[i], i, arr));
        }
        return mapped;
    }

    function arrayFindIndex(arr, fn) {
        for (var i = 0; i < arr.length; i++) {
            if (fn(arr[i], i, arr)) {
                return i;
            }
        }
        return -1;
    }

    // ----------------------------
    // Main Execution
    // ----------------------------

    if (jsonResponse.code !== 200) {
        throw new Error('Pricelists returned non-200 response');
    }

    var body = JSON.parse(jsonResponse.body);
    var ids = arrayMap(body.items, function (pricelist) {
        return pricelist.product_id;
    });

    var uniqueIds = arrayFilter(ids, function (productId, index, self) {
        return (
            index ===
            arrayFindIndex(self, function (otherProductId) {
                return productId === otherProductId;
            })
        );
    });

    validProductIds = uniqueIds;

    productOptions = arrayFilter(productOptions, function (option) {
        return validProductIds.indexOf(option.value) > -1;
    });

    // ----------------------------
    // Output
    // ----------------------------

    execution.setVariable('validProductIds', JSON.stringify(validProductIds));
    execution.setVariable('productOptions', JSON.stringify(productOptions));
} catch (err) {
    execution.setVariable('isAlive', false);
    execution.setVariable('errorMessage', err.message);
    execution.setVariable('errorCode', 'ERR_EXTRACT_VALID_PRODUCT_IDS');
}
