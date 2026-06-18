try {
    // ----------------------------
    // Input gathering
    // ----------------------------

    var jsonResponse = JSON.parse(execution.getVariable('fullPodPdrResponse'));

    // ----------------------------
    // Local variable initialization
    // ----------------------------

    var fullPodPdr;

    // ----------------------------
    // Main Execution
    // ----------------------------

    if (jsonResponse.code !== 200) {
        throw new Error('Fetch Staging returned non-200 response');
    }

    try {
        fullPodPdr = JSON.parse(jsonResponse.body);
    } catch (err) {
        throw new Error('Failed to load SP body: ' + err.message);
    }

    // ----------------------------
    // Output
    // ----------------------------

    execution.setVariable('fullPodPdr', JSON.stringify(fullPodPdr));
} catch (err) {
    execution.setVariable('isAlive', false);
    execution.setVariable(
        'errorCode',
        'CHECK_STAGING_DATA_GENERIC_FAIL: ' + err.message
    );
}
