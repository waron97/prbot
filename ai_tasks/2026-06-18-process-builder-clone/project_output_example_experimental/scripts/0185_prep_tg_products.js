try {
    // ----------------------------
    // Input gathering
    // ----------------------------

    var tgCategoryId = execution.getVariable('tgCategoryId');

    // ----------------------------
    // Output variable initialization
    // ----------------------------

    var searchProductPayload;

    // ----------------------------
    // Logical Helpers
    // ----------------------------

    // ----------------------------
    // Main Execution
    // ----------------------------

    searchProductPayload = {
        search: [
            {
                collection: 'products',
                query: {
                    type: 'product',
                    categoryid: tgCategoryId,
                },
            },
        ],
        options: {
            searchInChild: false,
        },
    };

    // ----------------------------
    // Output
    // ----------------------------

    execution.setVariable(
        'searchProductPayload',
        JSON.stringify(searchProductPayload)
    );
} catch (err) {
    execution.setVariable('isAlive', false);
    execution.setVariable('errorCode', 'ERR_PREP_TG_PRODUCTS');
    execution.setVariable('errorMessage', err.message);
}
