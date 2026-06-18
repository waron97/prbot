try {
    // ----------------------------
    // Input gathering
    // ----------------------------

    var jsonResponse = JSON.parse(execution.getVariable('searchProductResponse'));
    var currentPage = execution.getVariable('productPage', 1);
    var currentOptions = JSON.parse(execution.getVariable('productOptions', '[]'));
    var currentProducts = JSON.parse(execution.getVariable('products', '[]'));

    // ----------------------------
    // Output variable initialization
    // ----------------------------

    var productOptions = currentOptions || [];
    var products = currentProducts || [];
    var hasMoreProducts = false;
    var productPage = currentPage;

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

    function arrayForEach(arr, fn) {
        for (var i = 0; i < arr.length; i++) {
            fn(arr[i], i, arr);
        }
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

    var newProducts = JSON.parse(jsonResponse.body).products;
    var newProductOptions = parseOptions(newProducts);

    hasMoreProducts = newProducts.length === 100;
    productPage = productPage + 1;

    arrayForEach(newProducts, function (product) {
        products.push(product);
    });
    arrayForEach(newProductOptions, function (option) {
        productOptions.push(option);
    });

    // ----------------------------
    // Output
    // ----------------------------

    execution.setVariable('productOptions', JSON.stringify(productOptions));
    execution.setVariable('products', JSON.stringify(products));
    execution.setVariable('hasMoreProducts', hasMoreProducts);
    execution.setVariable('productPage', productPage);
} catch (err) {
    execution.setVariable('isAlive', false);
    execution.setVariable('errorMessage', err.message);
}
