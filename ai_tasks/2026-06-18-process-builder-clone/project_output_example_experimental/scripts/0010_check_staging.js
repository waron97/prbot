try {
    // ----------------------------
    // Input gathering
    // ----------------------------

    var jsonResponse = JSON.parse(
        execution.getVariable('process_data_response')
    );
    var baseUrl = execution.getVariable('odooEndpoint');

    // ----------------------------
    // Local variable initialization
    // ----------------------------

    var podPdrCode;
    var outgoingClientId;
    var assetType;
    var searchUrl;

    // ----------------------------
    // Logical Helpers
    // ----------------------------

    // ----------------------------
    // Main Execution
    // ----------------------------

    if (jsonResponse.code !== 200) {
        throw new Error('Fetch Staging returned non-200 response');
    }

    var stagingBody;
    var stagingPayload;

    try {
        stagingBody = JSON.parse(jsonResponse.body);
    } catch (err) {
        throw new Error('Could not parse staging body: ' + err.message);
    }

    if (stagingBody.length > 0) {
        stagingPayload = JSON.parse(stagingBody[0].payload);
    } else if (stagingBody.length === 0) {
        throw new Error('Staging Search returned empty array');
    } else {
        stagingPayload = JSON.parse(stagingBody.payload);
    }

    assetType = stagingPayload.assetType;

    podPdrCode = stagingPayload.podPdrCode;
    outgoingClientId = stagingPayload.podPdrClientId;

    if (!podPdrCode || !outgoingClientId || !assetType) {
        throw new Error(
            "'podPdrCode' or 'podPdrClientId' or 'assetType' missing from staging area payload"
        );
    }

    if (assetType === 'pod') {
        searchUrl =
            baseUrl + 'res.partner.pod/search_pod?pod_code=' + podPdrCode;
    } else {
        searchUrl =
            baseUrl + 'res.partner.pdr/search_pdr?pdr_code=' + podPdrCode;
    }

    // ----------------------------
    // Output
    // ----------------------------

    execution.setVariable('podPdrCode', podPdrCode);
    execution.setVariable('outgoingClientId', outgoingClientId);
    execution.setVariable('searchUrl', searchUrl);
    execution.setVariable('assetType', assetType);
} catch (err) {
    execution.setVariable('isAlive', false);
    execution.setVariable(
        'errorCode',
        'CHECK_STAGING_DATA_GENERIC_FAIL: ' + err.message
    );
}
