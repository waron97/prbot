try {
    // ----------------------------
    // Input gathering
    // ----------------------------

    var podResponse = JSON.parse(execution.getVariable('search_pod_response'));
    var clientResponse = JSON.parse(execution.getVariable('get_outgoing_client_response'));
    var meterResponse = JSON.parse(execution.getVariable('search_meter_response'));

    // ----------------------------
    // Output variable initialization
    // ----------------------------

    var podPdr;
    var outgoingClient;
    var meter;
    var meterType;
    var tariffType;

    // ----------------------------
    // Logical Helpers
    // ----------------------------

    function parseBodyFromResponse(response, resourceName) {
        if (response.code !== 200) {
            throw new Error("Resource '" + resourceName + "' returned non-200 response");
        }

        var body;

        if (!response.body) {
            throw new Error("Resource '" + resourceName + "' returned an empty body");
        }

        try {
            body = JSON.parse(response.body);
        } catch (err) {
            throw new Error(
                "Resource '" + resourceName + "' contains a non-parsable body: " + err.message
            );
        }

        if (body.length === 0) {
            throw new Error("Resource '" + resourceName + "' returned an empty list");
        }

        if (body.length > 0) {
            return body[0];
        }

        return body;
    }

    // ----------------------------
    // Main Execution
    // ----------------------------

    podPdr = parseBodyFromResponse(podResponse, 'POD_PDR_RESPONSE');
    outgoingClient = parseBodyFromResponse(clientResponse, 'CLIENT_RESPONSE');
    meter = parseBodyFromResponse(meterResponse, 'METER_RESPONSE');
    meterType = meter.type;
    tariffType = meter.tariff_type;

    // ----------------------------
    // Output
    // ----------------------------

    execution.setVariable('podPdr', JSON.stringify(podPdr));
    execution.setVariable('outgoingClient', JSON.stringify(outgoingClient));
    execution.setVariable('meter', JSON.stringify(meter));
    execution.setVariable('meterType', meterType || '');
} catch (err) {
    execution.setVariable('isAlive', false);
    execution.setVariable('errorMessage', err.message);
}
