try {
    // ----------------------------
    // Local variable initialization
    // ----------------------------

    var saveDataBody;

    // ----------------------------
    // Main Execution
    // ----------------------------

    var variableNames = [
        'start_date',
        'contract_signed_date',
        'legal_basis',
        'legal_possession_date',
        'voltura_type',
        'phone',
        'use_type',
        'use_category',
        'is_residence',
        'extraction_class',
        'isRetroactiveVoltura',
        'autocert',
        'no_debt',
        'no_debt_until',
        'annual_usage',
        'giroconto',
        'does_readings',
        'reading_date',
        'reading_a0f0',
        'reading_a1f1',
        'reading_a2f2',
        'reading_a3f3',
        'reading_gas',
        'multipunto',
        'multipunto_profile',
        'payment_method_type',
        'mandate_type',
        'sdd_payment_method',
        'new_sdd_name',
        'new_sdd_cf_or_vat',
        'new_sdd_owner_name',
        'new_sdd_owner_surname',
        'new_sdd_iban',
        'new_sdd_signed_date',
        'invoice_type',
        'invoice_shipping_method',
        'billing_email',
        'new_billing_email',
        'shipping_address',
        'new_shipping_address',
        'automatic_contract_communication',
        'automatic_contract_communication_channel',
        'automatic_contract_communication_address',
        'charges_apply',
        'podCode',
        'asset_id',
        'catalog_id',
        'category_id',
        'category_id_gas',
        'offerCode',
        'selectedPriceList',
        'selectedProduct',
        'order_id',
        'config_id',
    ];

    var parsedVariables = {};

    variableNames.forEach(function (name) {
        var rawValue = execution.getVariable(name);
        if (rawValue === 'Y') {
            rawValue = true;
        } else if (rawValue === 'N') {
            rawValue = false;
        }
        try {
            parsedVariables[name] = JSON.parse(rawValue);
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (e) {
            parsedVariables[name] = rawValue || null;
        }
    });

    saveDataBody = {
        pb_id: execution.getProcessInstanceId(),
        process_name: 'ml_voltura_data_input',
        res_id: execution.getVariable('case_id'),
        payload: JSON.stringify(parsedVariables),
    };

    // ----------------------------
    // Output
    // ----------------------------

    execution.setVariable('saveDataBody', JSON.stringify(saveDataBody));
} catch (err) {
    execution.setVariable('isAlive', false);
    execution.setVariable('errorMessage', err.message);
}
