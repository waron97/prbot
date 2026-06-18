try {
    // ----------------------------
    // Input gathering
    // ----------------------------

    var incomingClientSddMethods = JSON.parse(
        execution.getVariable('incomingClientSddMethods')
    );

    var allClientProfiles = JSON.parse(
        execution.getVariable('incomingClientProfiles')
    );

    var contract_signed_date = execution.getVariable('contract_signed_date');

    var interaction_client_email = execution.getVariable(
        'interaction_client_email'
    );
    var interaction_client_business_email = execution.getVariable(
        'interaction_client_business_email'
    );
    var interaction_partner_email = execution.getVariable(
        'interaction_partner_email'
    );
    var interaction_partner_business_email = execution.getVariable(
        'interaction_partner_business_email'
    );

    var incomingClientAddresses = JSON.parse(
        execution.getVariable('incomingClientAddresses')
    );

    // ----------------------------
    // Output variable initialization
    // ----------------------------

    var hasSddProfiles;

    var mandateTypeOptions;
    var mandate_type;

    var paymentMethodOptions;
    var payment_method_type;

    var invoiceShippingMethodOptions;
    var invoice_shipping_method;

    var invoiceTypeOptions;
    var invoice_type;

    var emailOptions;
    var billing_email;

    var addressOptions;
    var shipping_address;

    var new_sdd_signed_date;
    var newSddSignedDateMaxDate;

    var automaticContractCommunicationChannelOptions;
    var automatic_contract_communication_channel;

    var automatic_contract_communication_email;
    var automatic_contract_communication_address;
    var charges_apply;

    // ----------------------------
    // Logical Helpers
    // ----------------------------

    function arrayFilter(arr, fn) {
        var filtered = [];
        for (var i = 0; i < arr.length; i++) {
            if (fn(arr[i], i, arr)) {
                filtered.push(arr[i]);
            }
        }
        return filtered;
    }

    function arrayForEach(arr, fn) {
        for (var i = 0; i < arr.length; i++) {
            fn(arr[i], i, arr);
        }
    }

    function arrayMap(arr, fn) {
        var mapped = [];
        for (var i = 0; i < arr.length; i++) {
            mapped.push(fn(arr[i], i, arr));
        }
        return mapped;
    }

    function arrayFind(arr, fn) {
        for (var i = 0; i < arr.length; i++) {
            if (fn(arr[i], i, arr)) {
                return arr[i];
            }
        }
        return undefined;
    }

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

    function safeGet(obj, path, defaultValue) {
        if (!obj) return defaultValue;

        var props = typeof path === 'string' ? path.split('.') : path;
        if (
            !props ||
            !props.length ||
            Object.prototype.toString.call(props) !== '[object Array]'
        ) {
            return defaultValue;
        }

        for (var i = 0; i < props.length; i++) {
            if (obj == null) return defaultValue;
            obj = obj[props[i]];
        }

        return obj === undefined ? defaultValue : obj;
    }

    // ----------------------------

    function collectEmails() {
        var emails = [
            interaction_client_business_email,
            interaction_client_email,
            interaction_partner_business_email,
            interaction_partner_email,
        ];

        arrayForEach(allClientProfiles, function (profile) {
            emails.push(profile.email);
        });

        emails = arrayFilter(emails, Boolean);
        emails = arrayFilter(emails, function (email, index, self) {
            // dedupe
            return self.indexOf(email) === index;
        });

        return emails;
    }

    function getFormattedAddress(address) {
        var parts = arrayFilter(
            [
                safeGet(address.toponym_id, '1'),
                address.street,
                address.street_num,
                safeGet(address.city_id, '1'),
                safeGet(address.state_id, '1'),
                address.region,
                safeGet(address.country_id, '1'),
                address.zip,
            ],
            Boolean
        );
        return parts.join(' ').trim();
    }

    function collectAddressOptions() {
        return arrayMap(incomingClientAddresses, function (address) {
            return {
                text: getFormattedAddress(address),
                value: address.id,
            };
        });
    }

    // ----------------------------
    // Main Execution
    // ----------------------------

    mandateTypeOptions = [
        { text: 'Mandati esistenti', value: 'existing' },
        { text: 'Nuovo mandato', value: 'new' },
    ];

    paymentMethodOptions = [
        { text: 'SDD', value: 'sdd' },
        { text: 'Bollettino', value: 'bank_slip' },
        { text: 'Bonifico', value: 'transfer' },
    ];
    payment_method_type = 'sdd';

    invoiceTypeOptions = [
        {
            text: 'Sintetica',
            value: 'basic',
        },
        {
            text: 'Di Dettaglio',
            value: 'detailed',
        },
    ];

    invoice_type = 'basic';

    invoiceShippingMethodOptions = [
        { text: 'Digitale', value: 'digital' },
        { text: 'Cartaceo', value: 'paper' },
    ];

    invoice_shipping_method = 'digital';

    if (incomingClientSddMethods.length > 0) {
        hasSddProfiles = 'Y';
        mandate_type = 'existing';
    } else {
        hasSddProfiles = 'N';
        mandate_type = 'new';
        mandateTypeOptions = [{ text: 'Nuovo mandato', value: 'new' }];
    }

    new_sdd_signed_date = contract_signed_date;
    newSddSignedDateMaxDate = formatDateES5(new Date());

    emailOptions = arrayMap(collectEmails(), function (email) {
        return {
            text: email,
            value: email,
        };
    });

    if (emailOptions.length > 0) {
        billing_email = emailOptions[0].value;
    } else {
        billing_email = 'new';
    }

    emailOptions.push({
        text: 'Nuovo indirizzo',
        value: 'new',
    });

    addressOptions = collectAddressOptions();

    if (addressOptions.length > 0) {
        shipping_address = addressOptions[0].value;
    } else {
        shipping_address = 'new';
    }

    addressOptions.unshift({
        text: 'Nuovo indirizzo',
        value: 'new',
    });

    automaticContractCommunicationChannelOptions = [
        { text: 'E-mail', value: 'email' },
        { text: 'Cartaceo', value: 'paper' },
    ];
    automatic_contract_communication_channel = 'email';

    automatic_contract_communication_email = interaction_client_email;
    automatic_contract_communication_address =
        safeGet(
            arrayFind(incomingClientAddresses, function (address) {
                return address.address_type === 'sede_legale';
            }),
            'id'
        ) || 'new';

    charges_apply = true;

    // ----------------------------
    // Output
    // ----------------------------

    execution.setVariable('hasSddProfiles', hasSddProfiles);

    execution.setVariable(
        'mandateTypeOptions',
        JSON.stringify(mandateTypeOptions)
    );
    execution.setVariable('mandate_type', mandate_type);

    execution.setVariable(
        'paymentMethodOptions',
        JSON.stringify(paymentMethodOptions)
    );
    execution.setVariable('payment_method_type', payment_method_type);

    execution.setVariable(
        'invoiceShippingMethodOptions',
        JSON.stringify(invoiceShippingMethodOptions)
    );
    execution.setVariable('invoice_shipping_method', invoice_shipping_method);

    execution.setVariable(
        'invoiceTypeOptions',
        JSON.stringify(invoiceTypeOptions)
    );
    execution.setVariable('invoice_type', invoice_type);

    execution.setVariable('emailOptions', JSON.stringify(emailOptions));
    execution.setVariable('billing_email', billing_email);

    execution.setVariable('addressOptions', JSON.stringify(addressOptions));
    execution.setVariable('shipping_address', shipping_address);

    execution.setVariable('new_sdd_signed_date', new_sdd_signed_date);
    execution.setVariable('newSddSignedDateMaxDate', newSddSignedDateMaxDate);

    execution.setVariable(
        'automaticContractCommunicationChannelOptions',
        JSON.stringify(automaticContractCommunicationChannelOptions)
    );
    execution.setVariable(
        'automatic_contract_communication_channel',
        automatic_contract_communication_channel
    );

    execution.setVariable(
        'automatic_contract_communication_email',
        automatic_contract_communication_email
    );
    execution.setVariable(
        'automatic_contract_communication_address',
        automatic_contract_communication_address
    );
    execution.setVariable('charges_apply', charges_apply);
} catch (err) {
    execution.setVariable('isAlive', false);
    execution.setVariable('errorMessage', err.message);
}
