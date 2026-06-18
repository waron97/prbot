try {
    // ----------------------------
    // Input gathering
    // ----------------------------

    var jsonResponse = JSON.parse(execution.getVariable('getCategoriesResponse'));
    var outgoingAsset = JSON.parse(execution.getVariable('outgoingAsset'));
    var productPage = execution.getVariable('productPage', 1);

    // ----------------------------
    // Output variable initialization
    // ----------------------------

    var searchProductPayload;

    // ----------------------------
    // Logical Helpers
    // ----------------------------

    function arrayFind(arr, fn) {
        for (var i = 0; i < arr.length; i++) {
            if (fn(arr[i], i, arr)) {
                return arr[i];
            }
        }
        return undefined;
    }

    // ----------------------------
    // Main Execution
    // ----------------------------

    if (jsonResponse.code !== 200) {
        throw new Error('Get Categories returned non-200 response');
    }

    var body;

    try {
        body = JSON.parse(jsonResponse.body);
    } catch (err) {
        throw new Error('Categories returned non-parsable response: ' + err.message);
    }

    var powerCategoryRes = arrayFind(body.catalog.categories, function (category) {
        return category.name === 'LUCE RESIDENZIALE';
    });

    var powerCategoryBus = arrayFind(body.catalog.categories, function (category) {
        return category.name === 'LUCE BUSINESS';
    });

    var gasCategoryRes = arrayFind(body.catalog.categories, function (category) {
        return category.name === 'GAS RESIDENZIALE';
    });

    var gasCategoryBus = arrayFind(body.catalog.categories, function (category) {
        return category.name === 'GAS BUSINESS';
    });

    if (!powerCategoryRes || !powerCategoryBus) {
        throw new Error('Category not found: power');
    }
    if (!gasCategoryRes || !gasCategoryBus) {
        throw new Error('Category not found: gas');
    }

    var categoryFilter =
        outgoingAsset.commodity === 'pod'
            ? [powerCategoryRes._id, powerCategoryBus._id]
            : [gasCategoryRes._id, gasCategoryBus._id];

    searchProductPayload = {
        search: [
            {
                collection: 'products',
                query: {
                    type: 'product',
                    categoryid: {
                        $in: categoryFilter,
                    },
                },
            },
        ],
        options: {
            searchInChild: false,
        },
        limit: 100,
        page: productPage,
    };

    //     {
    //     "filters": [
    //         {
    //             "_$or": [
    //                 {
    //                     "product_id": "734489-custom_field-490493",
    //                     "start_validity_pricelist": {
    //                         "_$lte": "{{catalogDateFilter}}"
    //                     },
    //                     "end_validity_pricelist": {
    //                         "_$gte": "{{catalogDateFilter}}"
    //                     }
    //                 },
    //                 {
    //                     "product_id": "734489-custom_field-490493",
    //                     "_id": "{{selectedPriceList}}"
    //                 }
    //             ]
    //         }
    //     ],
    //     "size": 1000000,
    //     "page": 1,
    //     "group_to_show": "all",
    //     "catalog_guid": "{{catalog_guid}}",
    //     "pricelist_guid": "{{pricelist_guid}}"
    // }

    // ----------------------------
    // Output
    // ----------------------------

    execution.setVariable('category_id_ele_res', powerCategoryRes._id);
    execution.setVariable('category_id_ele_bus', powerCategoryBus._id);

    execution.setVariable('category_id_gas_res', gasCategoryRes._id);
    execution.setVariable('category_id_gas_bus', gasCategoryBus._id);

    execution.setVariable('searchProductPayload', JSON.stringify(searchProductPayload));
} catch (err) {
    execution.setVariable('isAlive', false);
    execution.setVariable('errorMessage', err.message);
}
