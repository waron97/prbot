try {
    // ----------------------------
    // Input gathering
    // ----------------------------

    var incomingClientType = execution.getVariable('incoming_client_type');
    var podPdr = JSON.parse(execution.getVariable('podPdr'));
    var interaction_date = execution.getVariable('interaction_date');

    // ----------------------------
    // Output variable initialization
    // ----------------------------

    var legalBasisOptions;
    var volturaTypeOptions;
    var legal_basis;
    var voltura_type;
    var contract_signed_date;

    var volturaMinDate;
    var contractMaxDate;

    // ----------------------------
    // Logical Helpers
    // ----------------------------

    function pad(number, width, paddingCharacter) {
        paddingCharacter = paddingCharacter || '0';
        number = number + ''; // Convert to string
        return number.length >= width
            ? number
            : new Array(width - number.length + 1).join(paddingCharacter) +
                  number;
    }

    function formatDateES5(d) {
        var year = d.getFullYear();
        var month = d.getMonth() + 1; // Month is 0-indexed
        var day = d.getDate();

        var paddedMonth = pad(month, 2, '0');
        var paddedDay = pad(day, 2, '0');

        return year + '-' + paddedMonth + '-' + paddedDay;
    }

    // ----------------------------
    // Main Execution
    // ----------------------------

    var isCompany = incomingClientType === 'company';

    legalBasisOptions = [
        { text: 'Proprietà', value: 'possession' },
        { text: 'Usufrutto', value: 'use' },
        { text: 'Locazione', value: 'location' },
        { text: 'Altro', value: 'other' },
    ];

    volturaTypeOptions = [{ text: 'Voltura', value: 'voltura' }];

    if (isCompany) {
        volturaTypeOptions.push({
            text: 'Incorporazione societaria',
            value: 'acquisition',
        });
    }

    if (!isCompany) {
        volturaTypeOptions.push({
            text: 'Mortis causa',
            value: 'mortis_causa',
        });
    }

    legal_basis = null;
    voltura_type = 'voltura';

    volturaMinDate = podPdr.activation_date || false;
    contractMaxDate = formatDateES5(new Date());

    contract_signed_date = interaction_date;

    // ----------------------------
    // Output
    // ----------------------------

    execution.setVariable(
        'legalBasisOptions',
        JSON.stringify(legalBasisOptions)
    );
    execution.setVariable(
        'volturaTypeOptions',
        JSON.stringify(volturaTypeOptions)
    );

    execution.setVariable('legal_basis', legal_basis);
    execution.setVariable('voltura_type', voltura_type);
    execution.setVariable('contract_signed_date', contract_signed_date);

    execution.setVariable('contractMaxDate', contractMaxDate);
    execution.setVariable('volturaMinDate', volturaMinDate);
} catch (err) {
    execution.setVariable('isAlive', false);
    execution.setVariable('errorMessage', err.message);
}
