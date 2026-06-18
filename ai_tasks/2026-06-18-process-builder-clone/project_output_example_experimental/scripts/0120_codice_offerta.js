try {
    // ----------------------------
    // Input gathering
    // ----------------------------

    var jsonResponse = JSON.parse(execution.getVariable('offerCodesResponse'));

    // ----------------------------
    // Output variable initialization
    // ----------------------------

    var offerCode;

    // ----------------------------
    // Main Execution
    // ----------------------------

    if (jsonResponse.code !== 200) {
        throw new Error('Fetch Staging returned non-200 response');
    }

    var body;

    try {
        body = JSON.parse(jsonResponse.body);
    } catch (err) {
        throw new Error('Failed to load SP body: ' + err.message);
    }

    if (body.offer_codes.items.length > 0) {
        offerCode = body.offer_codes.items[0].offer_code;
    } else {
        offerCode = null;
    }

    // ----------------------------
    // Output
    // ----------------------------

    execution.setVariable('offerCode', offerCode);
} catch (err) {
    execution.setVariable('isAlive', false);
    execution.setVariable('errorCode', 'ERR_CODICI_OFFERTA');
    execution.setVariable('errorMessage', err.message);
}
