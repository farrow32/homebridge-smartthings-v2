const knownCapabilities = require("./libs/Constants").knownCapabilities,
    _ = require("lodash"),
    ServiceTypes = require('./ST_ServiceTypes'),
    Transforms = require('./ST_Transforms'),
    DeviceTypes = require('./ST_DeviceCharacteristics');
var Service, Characteristic;

module.exports = class ST_Accessories {
    constructor(platform) {
        this.mainPlatform = platform;
        this.logConfig = platform.logConfig;
        this.configItems = platform.getConfigItems();
        this.myUtils = platform.myUtils;
        this.log = platform.log;
        this.hap = platform.hap;
        this.uuid = platform.uuid;
        Service = platform.Service;
        Characteristic = platform.Characteristic;
        this.CommunityTypes = require("./libs/CommunityTypes")(Service, Characteristic);
        this.client = platform.client;
        this.comparator = this.comparator.bind(this);
        this.transforms = new Transforms(this, Characteristic);
        this.serviceTypes = new ServiceTypes(this, Service);
        this.device_types = new DeviceTypes(this, Characteristic);
        this._accessories = {};
        this._attributeLookup = {};
    }

    initializeAccessory(accessory, fromCache = false) {
        if (!fromCache) {
            accessory.deviceid = accessory.context.deviceData.deviceid;
            accessory.name = accessory.context.deviceData.name;
            accessory.context.deviceData.excludedCapabilities.forEach(cap => {
                if (cap !== undefined) {
                    this.log.debug(`Removing capability: ${cap} from Device: ${accessory.context.deviceData.name}`);
                    delete accessory.context.deviceData.capabilities[cap];
                }
            });
            accessory.context.name = accessory.context.deviceData.name;
            accessory.context.deviceid = accessory.context.deviceData.deviceid;
        } else {
            this.log.debug(`Initializing Cached Device ${accessory.context.deviceid}`);
            accessory.deviceid = accessory.context.deviceid;
            accessory.name = accessory.context.name;
        }
        try {
            accessory.context.uuid = accessory.UUID || this.uuid.generate(`smartthings_v2_${accessory.deviceid}`);
            accessory.getOrAddService = this.getOrAddService.bind(accessory);
            accessory.getOrAddCharacteristic = this.getOrAddCharacteristic.bind(accessory);
            accessory.hasCapability = this.hasCapability.bind(accessory);
            accessory.getCapabilities = this.getCapabilities.bind(accessory);
            accessory.hasAttribute = this.hasAttribute.bind(accessory);
            accessory.hasCommand = this.hasCommand.bind(accessory);
            accessory.hasDeviceFlag = this.hasDeviceFlag.bind(accessory);
            accessory.hasService = this.hasService.bind(accessory);
            accessory.hasCharacteristic = this.hasCharacteristic.bind(accessory);
            accessory.updateDeviceAttr = this.updateDeviceAttr.bind(accessory);
            accessory.updateCharacteristicVal = this.updateCharacteristicVal.bind(accessory);
            accessory.manageGetCharacteristic = this.device_types.manageGetCharacteristic.bind(accessory);
            accessory.manageGetSetCharacteristic = this.device_types.manageGetSetCharacteristic.bind(accessory);
            return this.configureCharacteristics(accessory);
        } catch (err) {
            this.log.error(`initializeAccessory (fromCache: ${fromCache}) Error: ${err}`);
            console.error(err);
            return accessory;
        }
    }

    configureCharacteristics(accessory, fromCache = false) {
        for (let index in accessory.context.deviceData.capabilities) {
            if (knownCapabilities.indexOf(index) === -1 && this.mainPlatform.unknownCapabilities.indexOf(index) === -1) this.mainPlatform.unknownCapabilities.push(index);
        }
        accessory.context.deviceGroups = [];
        accessory.servicesToKeep = [];
        accessory.reachable = true;
        accessory.context.lastUpdate = new Date();

        let accessoryInformation = accessory
            .getOrAddService(Service.AccessoryInformation)
            .setCharacteristic(Characteristic.FirmwareRevision, accessory.context.deviceData.firmwareVersion)
            .setCharacteristic(Characteristic.Manufacturer, accessory.context.deviceData.manufacturerName)
            .setCharacteristic(Characteristic.Model, `${this.myUtils.toTitleCase(accessory.context.deviceData.modelName)}`)
            .setCharacteristic(Characteristic.Name, accessory.context.deviceData.name);
        accessory.servicesToKeep.push(Service.AccessoryInformation.UUID);

        if (!accessoryInformation.listeners("identify")) {
            accessoryInformation
                .on('identify', function(paired, callback) {
                    this.log.info("%s - identify", accessory.displayName);
                    callback();
                });
        }

        let svcTypes = this.serviceTypes.getServiceTypes(accessory);
        if (svcTypes) {
            svcTypes.forEach((svc) => {
                this.log.debug(accessory.name, ' | ', svc.name);
                accessory.servicesToKeep.push(svc.type.UUID);
                this.device_types[svc.name](accessory, svc.type);
            });
        } else {
            throw "Unable to determine the service type of " + accessory.deviceid;
        }
        return this.removeUnusedServices(accessory);
    }

    processDeviceAttributeUpdate(change) {
        let that = this;
        return new Promise((resolve) => {
            let characteristics = this.getAttributeStoreItem(change.attribute, change.deviceid);
            let accessory = this.getAccessoryFromCache(change);
            // console.log(characteristics);
            if (!characteristics || !accessory) return;
            if (characteristics instanceof Array) {
                characteristics.forEach(char => {
                    accessory.context.deviceData.attributes[change.attribute] = change.value;
                    accessory.context.lastUpdate = new Date().toLocaleString();
                    char.updateValue(that.transforms.transformAttributeState(change.attribute, change.value, char.displayName));
                    // char.getValue();
                });
                resolve(that.addAccessoryToCache(accessory));
            }
            resolve(false);
        });
    }

    hasCapability(obj) {
        let keys = Object.keys(this.context.deviceData.capabilities);
        if (keys.includes(obj) || keys.includes(obj.toString().replace(/\s/g, ""))) return true;
        return false;
    }

    getCapabilities() {
        return Object.keys(this.context.deviceData.capabilities);
    }

    hasAttribute(attr) {
        return Object.keys(this.context.deviceData.attributes).includes(attr) || false;
    }

    hasCommand(cmd) {
        return Object.keys(this.context.deviceData.commands).includes(cmd) || false;
    }

    getCommands() {
        return Object.keys(this.context.deviceData.commands);
    }

    hasService(service) {
        return this.services.map(s => s.UUID).includes(service.UUID) || false;
    }

    hasCharacteristic(svc, char) {
        let s = this.getService(svc) || undefined;
        return (s && s.getCharacteristic(char) !== undefined) || false;
    }

    updateCharacteristicVal(svc, char, val) {
        this.getOrAddService(svc).setCharacteristic(char, val);
    }

    updateCharacteristicProps(svc, char, props) {
        this.getOrAddService(svc).getCharacteristic(char).setProps(props);
    }

    hasDeviceFlag(flag) {
        return Object.keys(this.context.deviceData.deviceflags).includes(flag) || false;
    }

    updateDeviceAttr(attr, val) {
        this.context.deviceData.attributes[attr] = val;
    }

    getOrAddService(svc) {
        return (this.getService(svc) || this.addService(svc));
    }

    getOrAddCharacteristic(service, characteristic) {
        return (service.getCharacteristic(characteristic) || service.addCharacteristic(characteristic));
    }

    getServices() {
        return this.services;
    }

    removeUnusedServices(acc) {
        // console.log('servicesToKeep:', acc.servicesToKeep);
        let newSvcUuids = acc.servicesToKeep || [];
        let svcs2rmv = acc.services.filter(s => !newSvcUuids.includes(s.UUID));
        if (Object.keys(svcs2rmv).length) {
            this.log.info('removeServices:', JSON.stringify(svcs2rmv));
        }
        // svcs2rmv.forEach(s => acc.removeService(s));
        return acc;
    }

    storeCharacteristicItem(attr, devid, char) {
        // console.log('storeCharacteristicItem: ', attr, devid, char);
        if (!this._attributeLookup[attr]) {
            this._attributeLookup[attr] = {};
        }
        if (!this._attributeLookup[attr][devid]) {
            this._attributeLookup[attr][devid] = [];
        }
        this._attributeLookup[attr][devid].push(char);
    }

    getAttributeStoreItem(attr, devid) {
        if (!this._attributeLookup[attr] || !this._attributeLookup[attr][devid]) {
            return undefined;
        }
        return this._attributeLookup[attr][devid] || undefined;
    }

    removeAttributeStoreItem(attr, devid) {
        if (!this._attributeLookup[attr] || !this._attributeLookup[attr][devid]) return;
        delete this._attributeLookup[attr][devid];
    }

    getDeviceAttributeValueFromCache(device, attr) {
        const key = this.getAccessoryId(device);
        let result = this._accessories[key] ? this._accessories[key].context.deviceData.attributes[attr] : undefined;
        this.log.info(`Attribute (${attr}) Value From Cache: [${result}]`);
        return result;
    }

    getAccessoryId(accessory) {
        const id = accessory.deviceid || accessory.context.deviceid || undefined;
        return id;
    }

    getAccessoryFromCache(device) {
        const key = this.getAccessoryId(device);
        return this._accessories[key];
    }

    getAllAccessoriesFromCache() {
        return this._accessories;
    }

    clearAccessoryCache() {
        this.log.alert("CLEARING ACCESSORY CACHE AND FORCING DEVICE RELOAD");
        this._accessories = {};
    }

    addAccessoryToCache(accessory) {
        const key = this.getAccessoryId(accessory);
        this._accessories[key] = accessory;
        return true;
    }

    removeAccessoryFromCache(accessory) {
        const key = this.getAccessoryId(accessory);
        const _accessory = this._accessories[key];
        delete this._accessories[key];
        return _accessory;
    }

    forEach(fn) {
        return _.forEach(this._accessories, fn);
    }

    intersection(devices) {
        const accessories = _.values(this._accessories);
        return _.intersectionWith(devices, accessories, this.comparator);
    }

    diffAdd(devices) {
        const accessories = _.values(this._accessories);
        return _.differenceWith(devices, accessories, this.comparator);
    }

    diffRemove(devices) {
        const accessories = _.values(this._accessories);
        return _.differenceWith(accessories, devices, this.comparator);
    }

    comparator(accessory1, accessory2) {
        return this.getAccessoryId(accessory1) === this.getAccessoryId(accessory2);
    }

    clearAndSetTimeout(timeoutReference, fn, timeoutMs) {
        if (timeoutReference) clearTimeout(timeoutReference);
        return setTimeout(fn, timeoutMs);
    }
};