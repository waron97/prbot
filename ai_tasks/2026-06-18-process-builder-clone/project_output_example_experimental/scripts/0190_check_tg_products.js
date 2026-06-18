try {
    // ----------------------------
    // Input gathering
    // ----------------------------

    var jsonResponse = JSON.parse(execution.getVariable('searchProductResponse'));

    // ----------------------------
    // Output variable initialization
    // ----------------------------

    var productOptions;
    var products;

    // ----------------------------
    // Logical Helpers
    // ----------------------------

    function arrayMap(arr, fn) {
        var mapped = [];
        for (var i = 0; i < arr.length; i++) {
            mapped.push(fn(arr[i], i, arr));
        }
        return mapped;
    }

    // ----------------------------

    function parseOptions(products) {
        return arrayMap(products, function (product) {
            return {
                text: product.name,
                value: product._id,
            };
        });
    }

    // ----------------------------
    // Main Execution
    // ----------------------------

    if (jsonResponse.code !== 200) {
        throw new Error('Failed to retrieve products');
    }

    products = JSON.parse(jsonResponse.body).products;

    productOptions = parseOptions(products);

    // ----------------------------
    // Output
    // ----------------------------

    execution.setVariable('productOptions', JSON.stringify(productOptions));
    execution.setVariable('products', JSON.stringify(products));
} catch (err) {
    execution.setVariable('isAlive', false);
    execution.setVariable('errorMessage', err.message);
}
