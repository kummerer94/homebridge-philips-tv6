const request = require("request");
const wol = require("wake_on_lan");

class PhilipsTV {
    constructor(config) {
        this.api = null;
        this.channelList = [];
        this.volume = {
            min: 0,
            max: 0,
            current: 0,
            muted: false,
        };

        const wolURL = config.wol_url;
        const baseURL = `http://${config.ip_address}:1925/6/`;

        console.log(`Registering ${baseURL} as URL for API.`);

        this.api = (path, body = null) => {
            return new Promise((success, fail) => {
                request(
                    {
                        timeout: 3000,
                        method: body ? "POST" : "GET",
                        body: typeof body === "object" ? JSON.stringify(body) : body,
                        url: `${baseURL}${path}`,
                    },
                    (error, response, body) => {
                        console.log(`Response for ${baseURL}${path}:`);
                        console.log(typeof body === "object" ? JSON.stringify(body) : body);
                        if (error) {
                            console.log(`Error in API call for ${path}: ${error}.`);
                            fail(error);
                        } else {
                            if (body && body.indexOf("{") !== -1) {
                                try {
                                    success(JSON.parse(body));
                                } catch (e) {
                                    console.log(`Unable to parse JSON: ${body}.`);
                                    fail(e);
                                }
                            } else {
                                success({});
                            }
                        }
                    }
                );
            });
        };

        this.wake = (callback) => {
            if (!wolURL) {
                callback(null, "EMPTY");
                return;
            }
            if (wolURL.substring(0, 3).toUpperCase() === "WOL") {
                //Wake on lan request
                const macAddress = wolURL.replace(/^WOL[:]?[\/]?[\/]?/gi, "");
                wol.wake(macAddress, function (error) {
                    if (error) {
                        callback(error);
                    } else {
                        callback(null, "OK");
                    }
                });
            } else {
                if (wolURL.length > 3) {
                    callback(new Error("Unsupported protocol: ", "ERROR"));
                } else {
                    callback(null, "EMPTY");
                }
            }
        };

        this.getPowerState = (callback) => {
            this.api("powerstate")
                .then((data) => {
                    callback && callback(null, data.powerstate === "On");
                })
                .catch((e) => {
                    callback && callback(null, false);
                });
        };

        this.setPowerState = (value, callback) => {
            if (value) {
                this.wake((wolState) => {});
            }

            this.api("powerstate", {
                powerstate: value ? "On" : "Standby",
            })
                .then((data) => {
                    callback(null, value);
                })
                .catch(() => {
                    callback(null, false);
                });
        };

        this.sendKey = (key) => this.api("input/key", { key });
        this.setChannel = (ccid) =>
            this.api("activities/tv", { channel: { ccid }, channelList: { id: "allsat" } });
        this.launchApp = (app) => this.api("activities/launch", app);
        this.getChannelList = () =>
            this.api("channeldb/tv/channelLists/all").then((response) => {
                if (response) {
                    return response.Channel;
                }
                return [];
            });
        this.presetToCCid = async (preset) => {
            if (!this.channelList.length) {
                this.channelList = await this.getChannelList();
            }
            const channel = this.channelList
                .filter((item) => parseInt(item.preset) === parseInt(preset))
                .pop();
            return channel ? channel.ccid : 0;
        };

        this.getCurrentSource = (inputs) => {
            return new Promise(async (resolve, reject) => {
                try {
                    const current = await this.api("activities/current");
                    const currentPkgname = current.component.packageName;
                    let currentTvPreset = 0;
                    let selected = 0;
                    if (
                        currentPkgname === "org.droidtv.channels" ||
                        currentPkgname === "org.droidtv.playtv"
                    ) {
                        const currentTV = await this.api("activities/tv");
                        currentTvPreset = parseInt(currentTV.channel.preset, 10);
                    }
                    inputs.forEach((item, index) => {
                        if (currentTvPreset && item.channel === currentTvPreset) {
                            selected = index;
                        } else if (
                            item.launch &&
                            item.launch.intent &&
                            item.launch.intent.component.packageName === currentPkgname
                        ) {
                            selected = index;
                        }
                    });
                    resolve(selected);
                } catch (e) {
                    resolve(0);
                }
            });
        };

        this.setSource = async (input, callback) => {
            if (input.channel) {
                await this.sendKey("WatchTV");
                //            await this.sendKey("Digit" + input.channel);
                //            await this.sendKey("Confirm");
                const ccid = await this.presetToCCid(input.channel);
                await this.setChannel(ccid);
            } else if (input.launch) {
                await this.launchApp(input.launch);
            } else {
                await this.sendKey("WatchTV");
            }
            callback(null);
        };

        this.getAmbilightState = (callback) => {
            this.api("ambilight/power")
                .then((data) => {
                    callback(null, data.power === "On");
                })
                .catch(() => {
                    callback(null, false);
                });
        };

        this.getVolumeState = (callback) => {
            this.api("audio/volume")
                .then((data) => {
                    this.volume = {
                        ...this.volume,
                        ...data,
                    };
                    const volume = Math.floor(
                        ((this.volume.current - this.volume.min) /
                            (this.volume.max - this.volume.min)) *
                            100
                    );
                    callback(null, volume);
                })
                .catch(() => {
                    callback(null, false);
                });
        };

        this.setVolumeState = (value, callback) => {
            this.volume.current = Math.round(
                this.volume.min + (this.volume.max - this.volume.min) * (value / 100)
            );
            this.api("audio/volume", this.volume)
                .then(() => {
                    callback(null, value);
                })
                .catch(() => {
                    callback(null, false);
                });
        };

        this.setMuteState = (value, callback) => {
            this.volume.muted = !value;
            this.api("audio/volume", this.volume)
                .then(() => {
                    callback(null, value);
                })
                .catch(() => {
                    callback(null, false);
                });
        };

        this.setAmbilightState = (value, callback) => {
            if (value) {
                this.api("ambilight/currentconfiguration", {
                    styleName: "FOLLOW_VIDEO",
                    isExpert: false,
                    menuSetting: "NATURAL",
                })
                    .then((data) => {
                        callback(null, true);
                    })
                    .catch(() => {
                        callback(null, false);
                    });
            } else {
                this.api("ambilight/power", {
                    power: "Off",
                })
                    .then((data) => {
                        callback(null, false);
                    })
                    .catch(() => {
                        callback(null, false);
                    });
            }
        };
    }
}

module.exports = PhilipsTV;
