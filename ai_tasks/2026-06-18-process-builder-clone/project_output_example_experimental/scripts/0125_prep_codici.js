try {
    // ----------------------------
    // Input gathering
    // ----------------------------

    var selectedPriceList = execution.getVariable('selectedPriceList');
    var catalog_guid = execution.getVariable('catalog_guid');
    var pricelist_guid = execution.getVariable('pricelist_guid');

    // ----------------------------
    // Output variable initialization
    // ----------------------------

    var offerCodesBody;

    // ----------------------------
    // Main Execution
    // ----------------------------

    offerCodesBody = {
        pagination_information: {
            pricelist_rows_pagination: {
                size: 10,
                page: 1,
            },
            offer_code_pagination: {
                size: 5,
                page: 1,
            },
            agency_criteria_pagination: {
                size: 10,
                page: 1,
            },
        },
        pricelist_key: selectedPriceList,
        catalog_guid: catalog_guid,
        pricelist_guid: pricelist_guid,
    };

    // ----------------------------
    // Output
    // ----------------------------

    execution.setVariable('offerCodesBody', JSON.stringify(offerCodesBody));
} catch (err) {
    execution.setVariable('isAlive', false);
    execution.setVariable('errorCode', '');
    execution.setVariable('errorMessage', err.message);
}
