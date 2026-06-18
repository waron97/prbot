try {
    // ----------------------------
    // Input gathering
    // ----------------------------

    var servicePoint = JSON.parse(execution.getVariable('servicePoint'));
    var mlCatalogId = execution.getVariable('mlCatalogId');
    var mlPricelistId = execution.getVariable('mlPricelistId');
    var tgCatalogId = execution.getVariable('tgCatalogId');
    var tgPricelistId = execution.getVariable('tgPricelistId');

    // ----------------------------
    // Output variable initialization
    // ----------------------------

    var catalog_guid;
    var pricelist_guid;
    var isMl;
    var isTg;

    // ----------------------------
    // Main Execution
    // ----------------------------

    var market = servicePoint.market;

    if (market === 'l') {
        isMl = true;
        isTg = false;
        catalog_guid = mlCatalogId;
        pricelist_guid = mlPricelistId;
    } else if (market === 't') {
        isMl = false;
        isTg = true;
        catalog_guid = tgCatalogId;
        pricelist_guid = tgPricelistId;
    } else {
        throw new Error("Service Point market was not one of 't' or 'l'");
    }

    // ----------------------------
    // Output
    // ----------------------------

    execution.setVariable('catalog_guid', catalog_guid);
    execution.setVariable('pricelist_guid', pricelist_guid);
    execution.setVariable('isMl', isMl);
    execution.setVariable('isTg', isTg);
} catch (err) {
    execution.setVariable('isAlive', false);
    execution.setVariable('errorCode', 'ERR_SET_CATALOG_AND_MARKET');
    execution.setVariable('errorMessage', err.message);
}
