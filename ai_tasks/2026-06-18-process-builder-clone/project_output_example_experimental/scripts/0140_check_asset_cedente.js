try {
    // ----------------------------
    // Input gathering
    // ----------------------------

    var jsonResponse = JSON.parse(execution.getVariable('outgoingAssetResult'));

    // ----------------------------
    // Output variable initialization
    // ----------------------------

    var outgoingAsset;

    // ----------------------------
    // Logical Helpers
    // ----------------------------
    // ----------------------------
    // Main Execution
    // ----------------------------

    if (jsonResponse.code !== 200) {
        throw new Error('Failed to get outgoing asset');
    }

    var body = JSON.parse(jsonResponse.body);
    var assets = body.results;

    if (!assets.length) {
        throw new Error('No assets found for outgoing service point');
    }

    assets.sort(function (a, b) {
        return new Date(a.startdate) - new Date(b.startdate);
    });

    outgoingAsset = assets[assets.length - 1];

    // ----------------------------
    // Output
    // ----------------------------

    execution.setVariable('outgoingAsset', JSON.stringify(outgoingAsset));
} catch (err) {
    execution.setVariable('isAlive', false);
    execution.setVariable('errorCode', 'ERR_CHECK_OUTGOING_ASSET');
    execution.setVariable('errorMessage', err.message);
}
