try {
    // ----------------------------
    // Input gathering
    // ----------------------------

    var outgoingAsset = JSON.parse(execution.getVariable('outgoingAsset'));
    var b2wEndpoint = execution.getVariable('b2wEndpoint');

    // ----------------------------
    // Output variable initialization
    // ----------------------------

    var getContractUrl;

    // ----------------------------
    // Main Execution
    // ----------------------------

    if (!outgoingAsset.contract_id) {
        throw new Error('Could not find contract id from outgoing asset');
    }

    getContractUrl = b2wEndpoint + 'api/ordermanagement/v1/contract/' + outgoingAsset.contract_id;

    // ----------------------------
    // Output
    // ----------------------------

    execution.setVariable('getContractUrl', getContractUrl);
} catch (err) {
    execution.setVariable('isAlive', false);
    execution.setVariable('errorCode', 'err_prep_outgoing_contract');
    execution.setVariable('errorMessage', err.message);
}
