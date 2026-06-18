try {
    // ----------------------------
    // Input gathering
    // ----------------------------

    var jsonResponse = JSON.parse(execution.getVariable('getContractResult'));

    // ----------------------------
    // Output variable initialization
    // ----------------------------

    var outgoingContract;

    // ----------------------------
    // Main Execution
    // ----------------------------

    if (jsonResponse.code !== 200) {
        throw new Error('Failed to download contract data');
    }

    outgoingContract = JSON.parse(jsonResponse.body);

    // ----------------------------
    // Output
    // ----------------------------

    execution.setVariable('outgoingContract', JSON.stringify(outgoingContract));
} catch (err) {
    execution.setVariable('isAlive', false);
    execution.setVariable('errorCode', '');
    execution.setVariable('errorMessage', err.message);
}
