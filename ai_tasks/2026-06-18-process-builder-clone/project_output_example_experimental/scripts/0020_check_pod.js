try {
    // ----------------------------
    // Input gathering
    // ----------------------------

    var searchPodResponse = JSON.parse(execution.getVariable('search_pod_response'));

    var baseUrl = execution.getVariable('odooEndpoint');

    var assetType = execution.getVariable('assetType');

    // ----------------------------
    // Local variable initialization
    // ----------------------------

    var podPdrId;
    var getMeterUrl;
    var servicePointId;
    var getFullPodPdrUrl;

    // ----------------------------
    // Logical Helpers
    // ----------------------------

    function handlePodNotFound() {
        throw new Error('POD not found');
    }

    function processPodResponse() {
        var podsOrPdrs;
        var podPdr;

        if (searchPodResponse.code !== 200) {
            throw new Error('Search POD/PDR failed with non-200 response');
        }

        try {
            podsOrPdrs = JSON.parse(searchPodResponse.body);
        } catch (err) {
            return handlePodNotFound(err);
        }

        if (podsOrPdrs && podsOrPdrs.length > 0) {
            podPdr = podsOrPdrs[0];
        } else {
            return handlePodNotFound();
        }

        podPdrId = podPdr['id'];
        servicePointId = podPdr['service_point_id'];

        if (assetType === 'pod') {
            getMeterUrl = baseUrl + 'res.partner.meter/search_meter?pod_id=' + podPdrId;
            getFullPodPdrUrl = baseUrl + 'res.partner.pod/' + podPdrId;
        } else {
            getMeterUrl = baseUrl + 'res.partner.meter.pdr/search_meter_pdr?pdr_id=' + podPdrId;
            getFullPodPdrUrl = baseUrl + 'res.partner.pdr/' + podPdrId;
        }
    }

    // ----------------------------
    // Main Execution
    // ----------------------------

    processPodResponse();

    // ----------------------------
    // Output
    // ----------------------------

    execution.setVariable('podPdrId', podPdrId);
    execution.setVariable('getMeterUrl', getMeterUrl);
    execution.setVariable('servicePointId', servicePointId);
    execution.setVariable('getFullPodPdrUrl', getFullPodPdrUrl);
} catch (err) {
    execution.setVariable('isAlive', false);
    execution.setVariable('errorMessage', err.message);
}
