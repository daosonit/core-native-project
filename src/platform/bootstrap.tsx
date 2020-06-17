import React from "react";
import {AppRegistry, AppState, AppStateStatus} from "react-native";
import {Provider} from "react-redux";
import {app} from "../app";
import {LoggerConfig} from "../Logger";
import {ErrorListener} from "../module";
import {call, delay} from "../typed-saga";
import {ErrorBoundary} from "../util/ErrorBoundary";
import {ajax} from "../util/network";
import {APIException} from "../Exception";
import {captureError} from "../util/error-util";

interface BootstrapOption {
    registeredAppName: string;
    componentType: React.ComponentType;
    errorListener: ErrorListener;
    beforeRendering?: () => Promise<any>;
    loggerConfig?: LoggerConfig;
}

const LOGGER_ACTION = "@@framework/logger";

export function startApp(config: BootstrapOption) {
    setupGlobalErrorHandler(config.errorListener);
    runBackgroundLoop(config.loggerConfig);
    renderRoot(config.registeredAppName, config.componentType, config.beforeRendering);
}

function setupGlobalErrorHandler(errorListener: ErrorListener) {
    app.errorHandler = errorListener.onError.bind(errorListener);
    ErrorUtils.setGlobalHandler((error, isFatal) => captureError(error, "@@framework/global", {severity: isFatal ? "fatal" : undefined}));
}

function renderRoot(registeredAppName: string, EntryComponent: React.ComponentType, beforeRendering?: () => Promise<any>) {
    class WrappedAppComponent extends React.PureComponent<{}, {initialized: boolean; appState: AppStateStatus}> {
        constructor(props: {}) {
            super(props);
            this.state = {initialized: false, appState: AppState.currentState};
        }

        async componentDidMount() {
            if (beforeRendering) {
                await beforeRendering();
            }
            this.setState({initialized: true});
            AppState.addEventListener("change", this.onAppStateChange);
        }

        componentWillUnmount() {
            AppState.removeEventListener("change", this.onAppStateChange);
        }

        onAppStateChange = (nextAppState: AppStateStatus) => {
            const {appState} = this.state;
            if (["inactive", "background"].includes(appState) && nextAppState === "active") {
                app.logger.info("@@ACTIVE", {prevState: appState});
            } else if (appState === "active" && ["inactive", "background"].includes(nextAppState)) {
                app.logger.info("@@INACTIVE", {nextState: nextAppState});
            }
            this.setState({appState: nextAppState});
        };

        render() {
            return (
                this.state.initialized && (
                    <Provider store={app.store}>
                        <ErrorBoundary>
                            <EntryComponent />
                        </ErrorBoundary>
                    </Provider>
                )
            );
        }
    }
    AppRegistry.registerComponent(registeredAppName, () => WrappedAppComponent);
}

function runBackgroundLoop(loggerConfig: LoggerConfig | undefined) {
    app.logger.info("@@ENTER", {});
    app.loggerConfig = loggerConfig || null;
    app.sagaMiddleware.run(function* () {
        while (true) {
            // Loop on every 30 second
            yield delay(30000);

            // Send collected log to event server
            yield* call(sendEventLogs);
        }
    });
}

export async function sendEventLogs(): Promise<void> {
    try {
        const loggerConfig = app.loggerConfig;
        if (loggerConfig) {
            const logs = app.logger.collect();
            if (logs.length > 0) {
                await ajax("POST", loggerConfig.serverURL, {}, {events: logs}, true);
                app.logger.empty();
            }
        }
    } catch (e) {
        if (e instanceof APIException) {
            // For APIException, retry always leads to same error, so have to give up
            const length = app.logger.collect().length;
            app.logger.empty();
            app.logger.exception(e, {droppedLogs: length.toString()}, LOGGER_ACTION);
        }
    }
}
