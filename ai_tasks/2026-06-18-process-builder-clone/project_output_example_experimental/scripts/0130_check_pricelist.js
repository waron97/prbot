try {
    // ----------------------------
    // Input gathering
    // ----------------------------

    var jsonResponse = JSON.parse(execution.getVariable('outgoingPricelistResult'));

    // ----------------------------
    // Output variable initialization
    // ----------------------------

    var selectedPriceList;

    // ----------------------------
    // Main Execution
    // ----------------------------

    if (jsonResponse.code !== 200) {
        throw new Error('GET pricelist returned non-200 response');
    }

    var body = JSON.parse(jsonResponse.body);

    if (!body.items || body.items.lenth === 0) {
        throw new Error('Pricelist not found');
    }

    selectedPriceList = body.items[0].listino_key;

    // ----------------------------
    // Output
    // ----------------------------

    execution.setVariable('selectedPriceList', selectedPriceList);
    execution.setVariable('mortisCausaError', false);
} catch (err) {
    execution.setVariable('mortisCausaError', true);
    execution.setVariable('mortisCausaErrorCode', 'ERR_CHECK_MORTIS_CAUSA_PRICELIST');
    execution.setVariable('mortisCausaErrorMessage', err.message);
    execution.setVariable('mortis_causa_pricelist_fail', true);
}
