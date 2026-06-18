try {
    // ----------------------------
    // Input gathering
    // ----------------------------

    var incomingClientType = execution.getVariable('incoming_client_type');
    var podPdr = JSON.parse(execution.getVariable('podPdr'));
    var fullPodPdr = JSON.parse(execution.getVariable('fullPodPdr'));
    var servicePoint = JSON.parse(execution.getVariable('servicePoint'));
    var interaction_date = execution.getVariable('interaction_date');
    var start_date = execution.getVariable('start_date');
    var legal_possession_date = execution.getVariable('legal_possession_date');
    var assetType = execution.getVariable('assetType');
    var voltura_type = execution.getVariable('voltura_type');

    // ----------------------------
    // Output variable initialization
    // ----------------------------

    var outgoing_use_type;
    var outgoing_use_category;
    var no_debt;
    var annual_usage;
    var reading_date;

    var yesNoOptions;
    var allUseTypeOptions;
    var useTypeOptions;
    var useCategoryOptions;
    var showAutoCert;
    var noDebtUntilMaxDate;
    var showNoDebt;
    var readingMaxDate;

    var extractionClassOptions;
    var outgoingExtractionClass;
    var declaredAnnualUsage;

    var mortis_causa_vulnerable = false;

    // ----------------------------
    // Logical Helpers
    // ----------------------------

    function pad(number, width, paddingCharacter) {
        paddingCharacter = paddingCharacter || '0';
        number = number + ''; // Convert to string
        return number.length >= width
            ? number
            : new Array(width - number.length + 1).join(paddingCharacter) + number;
    }

    function formatDateES5(d) {
        var year = d.getFullYear();
        var month = d.getMonth() + 1; // Month is 0-indexed
        var day = d.getDate();

        var paddedMonth = pad(month, 2, '0');
        var paddedDay = pad(day, 2, '0');

        return year + '-' + paddedMonth + '-' + paddedDay;
    }

    function findLabel(options, value) {
        for (var i = 0; i < options.length; i++) {
            if (options[i].value === value) {
                return options[i].text;
            }
        }
        return value;
    }

    // ----------------------------

    function getUseTypeOptions() {
        if (assetType === 'pod') {
            if (incomingClientType === 'person') {
                return [
                    { text: 'Domestico residente (TDR)', value: '01' },
                    { text: 'Domestico non residente (TDNR)', value: '02' },
                    { text: 'Altri usi', value: '03' },
                ];
            } else {
                return [
                    { text: 'Altri usi', value: '03' },
                    { text: 'Illuminazione pubblica', value: '04' },
                    { text: 'Domestico non residente (TDNR)', value: '02' },
                ];
            }
        } else {
            if (incomingClientType === 'person') {
                return [
                    { text: 'Cliente domestico', value: 'domestic' },
                    { text: 'Usi Diversi', value: 'other' },
                ];
            } else {
                return [
                    {
                        text: 'Condominio con uso domestico',
                        value: 'complex',
                    },
                    { text: 'Usi diversi', value: 'other' },
                    { text: 'Servizio pubblico', value: 'public' },
                ];
            }
        }
    }

    // ----------------------------
    // Main Execution
    // ----------------------------

    useTypeOptions = getUseTypeOptions();

    allUseTypeOptions = [
        { text: 'Domestico Residente', value: '01' },
        { text: 'Domestico Non Residente', value: '02' },
        { text: 'Altri usi', value: '03' },
        { text: 'Illuminazione pubblica', value: '04' },
        { text: 'Stazione di ricarica', value: '05' },
        { text: 'Altro', value: '06' },
        { text: 'BS', value: 'BS' },
        { text: 'Riscaldamento', value: 'C1' },
        {
            text: 'Uso cottura cibi e/o produzione di acqua calda sanitaria',
            value: 'C2',
        },
        {
            text: 'Riscaldamento + uso cottura cibi e/o produzione di acqua calda sanitaria',
            value: 'C3',
        },
        { text: 'Uso condizionamento', value: 'C4' },
        { text: 'Uso condizionamento + riscaldamento', value: 'C5' },
        { text: 'DM', value: 'DM' },
        { text: 'DO', value: 'DO' },
        { text: 'Uso tecnologico (artigianale industriale)', value: 'T1' },
        { text: 'Uso tecnologico + riscaldamento', value: 'T2' },
    ];

    useCategoryOptions = [
        { text: 'Riscaldamento', value: 'C1' },
        {
            text: 'Uso cottura cibi e/o produzione di acqua calda sanitaria',
            value: 'C2',
        },
        {
            text: 'Riscaldamento + uso cottura cibi e/o produzione di acqua calda sanitaria',
            value: 'C3',
        },
        { text: 'Uso condizionamento', value: 'C4' },
        { text: 'Uso condizionamento + riscaldamento', value: 'C5' },
        { text: 'Uso tecnologico (artigianale industriale)', value: 'T1' },
        { text: 'Uso tecnologico + riscaldamento', value: 'T2' },
    ];

    yesNoOptions = [
        { text: 'Sì', value: 'Y' },
        { text: 'No', value: 'N' },
    ];

    noDebtUntilMaxDate = new Date(start_date);
    noDebtUntilMaxDate.setDate(noDebtUntilMaxDate.getDate() - 1);
    noDebtUntilMaxDate = formatDateES5(noDebtUntilMaxDate);

    if (start_date > legal_possession_date) {
        showNoDebt = 'Y';
    } else {
        showNoDebt = 'N';
    }

    if (assetType === 'pod') {
        outgoing_use_type = findLabel(allUseTypeOptions, servicePoint.use_type);
    } else {
        outgoing_use_type = findLabel(allUseTypeOptions, fullPodPdr.pdr_type);
    }

    outgoing_use_category = servicePoint.use_category
        ? findLabel(useCategoryOptions, servicePoint.use_category)
        : '';
    annual_usage = podPdr.distributor_annual_usage || '';
    no_debt = 'N';
    reading_date = interaction_date;
    readingMaxDate = formatDateES5(new Date());

    if (podPdr.market_type === 'tg') {
        showAutoCert = 'Y';
    } else {
        showAutoCert = 'N';
    }

    extractionClassOptions = [
        { text: '7 giorni', value: '7' },
        { text: '6 giorni', value: '6' },
        { text: '5 giorni (T1 e T2)', value: '5' },
    ];

    outgoingExtractionClass = fullPodPdr.extraction_class
        ? findLabel(extractionClassOptions, fullPodPdr.extraction_class)
        : '';

    if (voltura_type === 'mortis_causa' && servicePoint.is_vulnerable) {
        mortis_causa_vulnerable = true;
    }

    // ----------------------------
    // Output
    // ----------------------------

    execution.setVariable('outgoing_use_type', outgoing_use_type);
    execution.setVariable('outgoing_use_category', outgoing_use_category);
    execution.setVariable('no_debt', no_debt);
    execution.setVariable('annual_usage', annual_usage);
    execution.setVariable('reading_date', reading_date);

    execution.setVariable('yesNoOptions', JSON.stringify(yesNoOptions));
    execution.setVariable('useTypeOptions', JSON.stringify(useTypeOptions));
    execution.setVariable('allUseTypeOptions', JSON.stringify(allUseTypeOptions));
    execution.setVariable('useCategoryOptions', JSON.stringify(useCategoryOptions));
    execution.setVariable('showAutoCert', showAutoCert);
    execution.setVariable('showNoDebt', showNoDebt);
    execution.setVariable('noDebtUntilMaxDate', noDebtUntilMaxDate);
    execution.setVariable('readingMaxDate', readingMaxDate);
    execution.setVariable('extractionClassOptions', JSON.stringify(extractionClassOptions));
    execution.setVariable('outgoingExtractionClass', outgoingExtractionClass);
    execution.setVariable('declaredAnnualUsage', declaredAnnualUsage || '');
    execution.setVariable('mortis_causa_vulnerable', mortis_causa_vulnerable);
} catch (err) {
    execution.setVariable('isAlive', false);
    execution.setVariable('errorMessage', err.message);
}
