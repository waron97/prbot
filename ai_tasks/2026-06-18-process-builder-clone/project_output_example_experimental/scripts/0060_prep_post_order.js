try {
    // ----------------------------
    // Input gathering
    // ----------------------------
    // ----------------------------
    // Output variable initialization
    // ----------------------------

    var post_order_body;
    var outgoingAsset = JSON.parse(execution.getVariable('outgoingAsset'));
    var outgoingContract = JSON.parse(execution.getVariable('outgoingContract'));

    // ----------------------------
    // Main Execution
    // ----------------------------

    post_order_body = {
        obj_type: 'Order',
        accountcode: execution.getVariable('incoming_client_id').toString(),
        crm_accountcode: execution.getVariable('incoming_client_code'),
        type: 'InOrder',
        subtype: 'Activation',
        industry: 'BSP Utility',
        commodity: outgoingAsset.commodity === 'pod' ? 'power' : 'gas',
        order_date: execution.getVariable('start_date'),
        channel: outgoingContract.channel,
        agent_id: outgoingContract.agent_id,
        agency_id: outgoingContract.agency_id,
        contract: true,
        singlecontract: true,
        options: {
            userLanguage: 'en-US',
            remotePagination: true,
            itemsForPage: 10,
            cartItemsForPage: 10,
        },
    };

    // ----------------------------
    // Output
    // ----------------------------

    execution.setVariable('post_order_body', JSON.stringify(post_order_body));
} catch (err) {
    execution.setVariable('isAlive', false);
    execution.setVariable('errorCode', 'PREPARE_ORDER_PAYLOAD_FAIL');
    execution.setVariable('errorMessage', err.message);
}
