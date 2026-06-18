try {
    // ----------------------------
    // Input gathering
    // ----------------------------

    var jsonResponse = JSON.parse(execution.getVariable('modifyResponse'));
    var selectedPrice = execution.getVariable('pricelist_guid');

    // ----------------------------
    // Output variable initialization
    // ----------------------------

    var updateFactPayload;

    // ----------------------------
    // Main Execution
    // ----------------------------

    if (jsonResponse.code !== 200) {
        throw new Error('Cart modify returned non-200 response');
    }

    var body = JSON.parse(jsonResponse.body);
    var configuration = body.configuration;
    configuration.pricelist = selectedPrice;
    var configurationid = configuration._id;
    updateFactPayload = {
        objectList: [
            {
                action: 'modify',
                type: 'configuration',
                uniqueid: '_id',
                value: configurationid,
                instance: configuration,
            },
        ],
        executeRules: true,
    };

    // ----------------------------
    // Output
    // ----------------------------

    execution.setVariable(
        'updateFactPayload',
        JSON.stringify(updateFactPayload)
    );
} catch (err) {
    execution.setVariable('isAlive', false);
    execution.setVariable('errorMessage', err.message);
    execution.setVariable('errorCode', 'GET_MODIFY_FAIL_GENERAL_ERROR');
}
