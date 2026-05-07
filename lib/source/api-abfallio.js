'use strict';

const BaseSource = require('./base');
const providers = require('../provider/api-abfallio');

class SourceApiAbfallIo extends BaseSource {
    async validate() {
        const provider = this.adapter.config.apiAbfallioProvider;
        const cityId = this.adapter.config.apiAbfallioCityId;
        const districtId = this.adapter.config.apiAbfallioDistrictId;
        const streetId = this.adapter.config.apiAbfallioStreetId;
        const houseNumber = this.adapter.config.apiAbfallioHouseNumber;

        if (provider && cityId && streetId && houseNumber) {
            if (districtId) {
                return true;
            }

            if (!(await this.cityHasDistricts(provider, cityId))) {
                return true;
            }
        }
        this.adapter.log.info(`[api-abfallio] incomplete configuration`);
        return false;
    }

    async getPickupDates() {
        const provider = this.adapter.config.apiAbfallioProvider;
        const cityId = this.adapter.config.apiAbfallioCityId;
        const districtId = this.adapter.config.apiAbfallioDistrictId;
        const streetId = this.adapter.config.apiAbfallioStreetId;
        const houseNumber = this.adapter.config.apiAbfallioHouseNumber;

        this.adapter.log.debug(
            `(0) [api-abfallio] update started by api - provider: ${provider} - cityId: "${cityId}" - districtId: ${districtId} streetId: "${streetId}" - houseNumber: "${houseNumber}"`,
        );

        try {
            const apiTypes = await this.getApiTypes(provider, cityId, districtId, streetId, houseNumber);
            const apiPickups = await this.getApiPickups(
                provider,
                houseNumber,
                apiTypes.map(t => t.id),
            );

            //this.adapter.log.debug(`(0) received api data: ${JSON.stringify(apiPickups)}`);

            const data = [];
            for (const pickup of apiPickups) {
                data.push({
                    date: pickup.date,
                    name: pickup.wasteType.name,
                    description: pickup.note,
                });
            }

            return data;
        } catch (err) {
            this.adapter.log.error(`(0) [api-abfallio] unable to parse api data: ${err.toString()}`);

            return [];
        }
    }

    async getApiProviders() {
        return Object.keys(providers).map(id => ({ id, ...providers[id] }));
    }

    async cityHasDistricts(provider, cityId) {
        const cities = await this.getApiCities(provider);
        const city = cities?.find(entry => String(entry.id) === String(cityId));

        return (city?.districtsCount ?? 0) > 0;
    }

    async getApiCities(provider) {
        const citiesData = await this.getApiCached(
            {
                method: 'post',
                baseURL: 'https://widgets.abfall.io/graphql',
                headers: {
                    'Content-Type': 'application/json',
                    Origin: providers[provider].url,
                    'x-abfallplus-api-key': providers[provider].apiKey,
                },
                data: JSON.stringify({
                    query: 'query GetCities($query: String) {\ncities(query: $query) {\nid\nname\nidHouseNumber\ndistrictsCount\nappointmentsSupported\n}\n}\n',
                    variables: { query: null },
                }),
            },
            `abfallio-cities-${provider}.json`,
        );

        return JSON.parse(citiesData)?.data?.cities ?? [];
    }

    async getApiDistricts(provider, cityId) {
        const districtsData = await this.getApiCached(
            {
                method: 'post',
                baseURL: 'https://widgets.abfall.io/graphql',
                headers: {
                    'Content-Type': 'application/json',
                    Origin: providers[provider].url,
                    'x-abfallplus-api-key': providers[provider].apiKey,
                },
                data: JSON.stringify({
                    query: 'query GetStreets($cityId: ID!, $query: String) {\ncity(id: $cityId) {\ndistricts(query: $query) {\nid\nname\nidHouseNumber\n}\n}\n}\n',
                    variables: { cityId: String(cityId), query: null },
                }),
            },
            `abfallio-districts-${provider}-${cityId}.json`,
        );

        return JSON.parse(districtsData)?.data?.city?.districts ?? [];
    }

    async getApiStreets(provider, cityId, districtId) {
        if (!cityId) {
            throw new Error('[api-abfallio] Unable to get streets - empty cityId');
        }

        const hasDistricts = await this.cityHasDistricts(provider, cityId);
        const useCityLookup = !hasDistricts;

        if (hasDistricts && !districtId) {
            throw new Error('[api-abfallio] Unable to get streets - empty districtId');
        }

        const streetsData = await this.getApiCached(
            {
                method: 'post',
                baseURL: 'https://widgets.abfall.io/graphql',
                headers: {
                    'Content-Type': 'application/json',
                    Origin: providers[provider].url,
                    'x-abfallplus-api-key': providers[provider].apiKey,
                },
                data: JSON.stringify(
                    useCityLookup
                        ? {
                              query: 'query GetStreets($id: ID!, $query: String) {\ncity(id: $id) {\nstreets(query: $query) {\nid\nname\nidHouseNumber\n}\n}\n}\n',
                              variables: { id: String(cityId), query: null },
                          }
                        : {
                              query: 'query GetStreets($id: ID!, $query: String) {\ndistrict(id: $id) {\nstreets(query: $query) {\nid\nname\nidHouseNumber\n}\n}\n}\n',
                              variables: { id: String(districtId), query: null },
                          },
                ),
            },
            `abfallio-streets-${provider}-${cityId}-${districtId || 'none'}.json`,
        );

        return useCityLookup
            ? JSON.parse(streetsData)?.data?.city?.streets ?? []
            : JSON.parse(streetsData)?.data?.district?.streets ?? [];
    }

    async getApiHouseNumbers(provider, cityId, districtId, streetId) {
        if (!cityId || !streetId) {
            throw new Error('[api-abfallio] Unable to get house numbers - empty cityId or streetId');
        }

        const hasDistricts = await this.cityHasDistricts(provider, cityId);

        if (hasDistricts && !districtId) {
            throw new Error('[api-abfallio] Unable to get house numbers - empty districtId');
        }

        const streetsData = await this.getApiCached(
            {
                method: 'post',
                baseURL: 'https://widgets.abfall.io/graphql',
                headers: {
                    'Content-Type': 'application/json',
                    Origin: providers[provider].url,
                    'x-abfallplus-api-key': providers[provider].apiKey,
                },
                data: JSON.stringify({
                    query: 'query GetHouseNumbers($streetId: ID!, $idDistrict: ID, $query: String) {\nstreet(id: $streetId) {\nhouseNumbers(query: $query, idDistrict: $idDistrict) {\nid\nname\n}\n}\n}\n',
                    variables: {
                        streetId: String(streetId),
                        query: null,
                        idDistrict: districtId ? String(districtId) : null,
                    },
                }),
            },
            `abfallio-housenumbers-${provider}-${cityId}-${districtId || 'none'}-${streetId}.json`,
        );

        return JSON.parse(streetsData)?.data?.street?.houseNumbers ?? [];
    }

    async getApiTypes(provider, cityId, districtId, streetId, houseNumber) {
        if (houseNumber) {
            if (cityId && streetId) {
                const houseNumbers = await this.getApiHouseNumbers(provider, cityId, districtId, streetId);
                const selectedHouseNumber = houseNumbers.find(entry => String(entry.id) === String(houseNumber));

                if (!selectedHouseNumber) {
                    throw new Error(
                        `[api-abfallio] House number "${houseNumber}" does not belong to street "${streetId}"`,
                    );
                }
            }

            const streetsData = await this.getApiCached(
                {
                    method: 'post',
                    baseURL: 'https://widgets.abfall.io/graphql',
                    headers: {
                        'Content-Type': 'application/json',
                        Origin: providers[provider].url,
                        'x-abfallplus-api-key': providers[provider].apiKey,
                    },
                    data: JSON.stringify({
                        query: 'query HouseNumber($houseNumberId: ID!) {\nhouseNumber(id: $houseNumberId) {\nwasteTypes {\nid\nname\ninternals {\npdfLegend\n}\n}\n}\n}\n',
                        variables: { houseNumberId: String(houseNumber) },
                    }),
                },
                `abfallio-types-${provider}-${houseNumber}.json`,
            );

            return JSON.parse(streetsData)?.data?.houseNumber?.wasteTypes ?? [];
        }
        throw new Error('[api-abfallio] Unable to get types - empty houseNumber');
    }

    async getApiPickups(provider, houseNumber, wasteTypes) {
        if (houseNumber) {
            const now = new Date();
            const pickupData = await this.getApiCached(
                {
                    method: 'post',
                    baseURL: 'https://widgets.abfall.io/graphql',
                    headers: {
                        'Content-Type': 'application/json',
                        Origin: providers[provider].url,
                        'x-abfallplus-api-key': providers[provider].apiKey,
                    },
                    data: JSON.stringify({
                        query: 'query Query($idHouseNumber: ID!, $wasteTypes: [ID], $dateMin: Date, $dateMax: Date, $showInactive: Boolean) {\nappointments(idHouseNumber: $idHouseNumber, wasteTypes: $wasteTypes, dateMin: $dateMin, dateMax: $dateMax, showInactive: $showInactive) {\nid\ndate\ntime\nlocation\nnote\nwasteType {\nid\nname\ncolor\ninternals {\npdfLegend\niconLow\n}\n}\n}\n}\n',
                        variables: {
                            idHouseNumber: String(houseNumber),
                            wasteTypes,
                            dateMin: `${now.getFullYear()}-01-01`,
                            dateMax: `${now.getFullYear()}-12-31`,
                            showInactive: false,
                        },
                    }),
                },
                `abfallio-pickups-${provider}-${houseNumber}.json`,
            );

            return JSON.parse(pickupData)?.data?.appointments ?? [];
        }
        throw new Error('[api-abfallio] Unable to get types - empty houseNumber');
    }
}

module.exports = SourceApiAbfallIo;
