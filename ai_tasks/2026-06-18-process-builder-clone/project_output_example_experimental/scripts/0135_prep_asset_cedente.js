try {
    // ----------------------------
    // Input gathering
    // ----------------------------

    var servicePoint = JSON.parse(execution.getVariable('servicePoint'));
    var b2wUrl = execution.getVariable('b2wEndpoint');

    // ----------------------------
    // Output variable initialization
    // ----------------------------

    var getOutgoingAssetUrl = b2wUrl + 'api/ordermanagement/v1/asset';

    // ----------------------------
    // Main Execution
    // ----------------------------

    var assetQuery = encodeURIComponent(
        ['type=product', 'prcode=' + servicePoint.code].join('&')
    );

    getOutgoingAssetUrl = getOutgoingAssetUrl + '?query=' + assetQuery;

    // ----------------------------
    // Output
    // ----------------------------

    execution.setVariable('getOutgoingAssetUrl', getOutgoingAssetUrl);
} catch (err) {
    execution.setVariable('isAlive', false);
    execution.setVariable('errorCode', '');
    execution.setVariable('errorMessage', err.message);
}
