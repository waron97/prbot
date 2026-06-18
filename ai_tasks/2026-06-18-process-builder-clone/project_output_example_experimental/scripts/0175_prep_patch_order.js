try {
    // ----------------------------
    // Input gathering
    // ----------------------------

    var productClientType = execution.getVariable('productClientType');
    var productOfferType = execution.getVariable('productOfferType');
    var signatureDate = execution.getVariable('contract_signed_date');
    var isTg = execution.getVariable('isTg');

    // ----------------------------
    // Output variable initialization
    // ----------------------------

    var patchOrderBody;

    // ----------------------------
    // Main Execution
    // ----------------------------

    var contractType = '';

    if (isTg) {
        contractType = 'BSN STD';
    } else if (productClientType === 'Res') {
        contractType = 'RES';
    } else if (productClientType === 'Bus') {
        if (productOfferType === 'Standard') {
            contractType = 'BSN STD';
        } else if (productOfferType === 'Non_Standard') {
            contractType = 'BSN NON STD';
        } else {
            contractType = 'RES';
        }
    } else {
        contractType = 'RES';
    }

    patchOrderBody = {
        contract_type: contractType,
        signaturedate: signatureDate,
    };

    // ----------------------------
    // Output
    // ----------------------------

    execution.setVariable('patchOrderBody', JSON.stringify(patchOrderBody));
} catch (err) {
    execution.setVariable('isAlive', false);
    execution.setVariable('errorCode', '');
    execution.setVariable('errorMessage', err.message);
}
