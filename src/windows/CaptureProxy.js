/*
    *
    * Licensed to the Apache Software Foundation (ASF) under one
    * or more contributor license agreements.  See the NOTICE file
    * distributed with this work for additional information
    * regarding copyright ownership.  The ASF licenses this file
    * to you under the Apache License, Version 2.0 (the
    * "License"); you may not use this file except in compliance
    * with the License.  You may obtain a copy of the License at
    *
    *   http://www.apache.org/licenses/LICENSE-2.0
    *
    * Unless required by applicable law or agreed to in writing,
    * software distributed under the License is distributed on an
    * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
    * KIND, either express or implied.  See the License for the
    * specific language governing permissions and limitations
    * under the License.
    *
    */

/* global Windows:true */

var MediaFile = require('cordova-plugin-media-capture.MediaFile');
var CaptureError = require('cordova-plugin-media-capture.CaptureError');
var CaptureAudioOptions = require('cordova-plugin-media-capture.CaptureAudioOptions');
var CaptureVideoOptions = require('cordova-plugin-media-capture.CaptureVideoOptions');
var MediaFileData = require('cordova-plugin-media-capture.MediaFileData');

/*
    * Class that combines all logic for capturing picture and video on WP8.1
    */
function MediaCaptureProxy() {

    var previewContainer,
        capturePreview = null,
        captureCancelButton = null,
        captureSettings = null,
        captureStarted = false,
        capturedPictureFile,
        capturedVideoFile,
        capture = null,
        usingBackCamera = false;

    var CaptureNS = Windows.Media.Capture;
	var PhotoOrientation = Windows.Graphics.Imaging.BitmapRotation;
	
    var currentPhotoOrientation;
    var translateService = angular.element(document.body).injector().get('$translate');
    var captureVideoTimeout;
    var captureVideoInterval;
    var captureVideoCounter;

    /**
     * Helper function that toggles visibility of DOM elements with provided ids
     * @param {String} variable number of elements' ids which visibility needs to be toggled
     */
    function toggleElements() {
        // convert arguments to array
        var args = Array.prototype.slice.call(arguments);
        args.forEach(function (buttonId) {
            var buttonEl = document.getElementById(buttonId);
            if (buttonEl) {
                var curDisplayStyle = buttonEl.style.display;
                buttonEl.style.display = curDisplayStyle === 'none' ? 'block' : 'none';
            }
        });
    }

    /**
     * Creates basic camera UI with preview 'video' element and 'Cancel' button
     * Capture starts, when you clicking on preview.
     */
    function createCameraUI() {
        var buttonStyle = "flex: 1; font-size: 30px; border: none; padding: 15px; box-shadow: none;";

        previewContainer = document.createElement('div');
        previewContainer.style.cssText = "background-position: 50% 50%; background-repeat: no-repeat; background-size: contain; background-color: black; left: 0px; top: 0px; width: 100%; height: 100%; position: fixed; z-index: 9999";
        previewContainer.innerHTML =
            '<video id="capturePreview" style="width: auto; height: calc(100% - 70px); position: absolute; top: calc(50% - 35px); left: 50%; transform: translateX(-50%) translateY(-50%);"></video>' +
            '<div id="previewButtons" class="abb-styleguide" style="width: 100%; bottom: 0px; display: flex; position: absolute; justify-content: space-betweeen; background-color: black;">' +
            '<button id="cancelCapture" class="secondary" style="' + buttonStyle + '">' + translateService.instant('CANCEL') + '</button>' +
            '<button id="takePicture" class="primary" style="' + buttonStyle + '">' + translateService.instant('CAPTURE') + '</button>' +
            '<button id="retakePicture" class="secondary" style="display: none; ' + buttonStyle + '">' + translateService.instant('RETAKE') + '</button>' +
            '<button id="selectPicture" class="primary" style="display: none; ' + buttonStyle + '">' + translateService.instant('ACCEPT') + '</button>' +
            '</div>';

        document.body.appendChild(previewContainer);

        // Create fullscreen preview
        capturePreview = document.getElementById('capturePreview');

        // Create cancel button
        captureCancelButton = document.getElementById('cancelCapture');

        capture = new CaptureNS.MediaCapture();

        captureSettings = new CaptureNS.MediaCaptureInitializationSettings();
        captureSettings.streamingCaptureMode = CaptureNS.StreamingCaptureMode.audioAndVideo;
    }

    /**
     * Starts camera preview and binds provided callbacks to controls
     * @param  {function} takeCallback   Callback for Take button
     * @param  {function} errorCallback  Callback for Cancel button + default error callback
     * @param  {function} selectCallback Callback for Select button
     * @param  {function} retakeCallback Callback for Retake button
     */
    function startCameraPreview(takeCallback, errorCallback, selectCallback, retakeCallback) {
        // try to select appropriate device for capture
        // rear camera is preferred option
        var expectedPanel = Windows.Devices.Enumeration.Panel.back;
        Windows.Devices.Enumeration.DeviceInformation.findAllAsync(Windows.Devices.Enumeration.DeviceClass.videoCapture).done(function (devices) {
            if (devices.length > 0) {
                devices.forEach(function (currDev) {
                    if (currDev.enclosureLocation && currDev.enclosureLocation.panel && currDev.enclosureLocation.panel == expectedPanel) {
                        captureSettings.videoDeviceId = currDev.id;
                        usingBackCamera = true;
                    }
                });

                capture.initializeAsync(captureSettings).done(function () {
                    Windows.Graphics.Display.DisplayInformation.getForCurrentView().addEventListener("orientationchanged", updatePreviewForRotation, false);
                    updatePreviewForRotation();
                    capturePreview.msZoom = false;

                    capturePreview.src = URL.createObjectURL(capture);
                    capturePreview.play();

                    previewContainer.style.display = 'block';

                    document.getElementById('takePicture').onclick = takeCallback;
                    document.getElementById('cancelCapture').onclick = function () {
                        errorCallback(CaptureError.CAPTURE_NO_MEDIA_FILES);
                    };
                    document.getElementById('selectPicture').onclick = selectCallback;
                    document.getElementById('retakePicture').onclick = retakeCallback;
                    document.getElementById('previewButtons').style.pointerEvents = 'auto';

                }, function (err) {
                    destroyCameraPreview();
                    errorCallback(CaptureError.CAPTURE_INTERNAL_ERR, err);
                });
            } else {
                // no appropriate devices found
                destroyCameraPreview();
                errorCallback(CaptureError.CAPTURE_INTERNAL_ERR);
            }
        });
    }

    function updatePreviewForRotation() {
        if (!capture) {
            return;
        }

        var displayOrientation = Windows.Graphics.Display.DisplayInformation.getForCurrentView().currentOrientation;
        var isMirrored = !usingBackCamera;

        var degreesToRotate;
        var rotation;

        switch (displayOrientation) {
            case Windows.Graphics.Display.DisplayOrientations.landscape:
                degreesToRotate = 0;
                break;
            case Windows.Graphics.Display.DisplayOrientations.portrait:
                if (isMirrored) {
                    degreesToRotate = 270;
                } else {
                    degreesToRotate = 90;
                }
                break;
            case Windows.Graphics.Display.DisplayOrientations.landscapeFlipped:
                degreesToRotate = 180;
                break;
            case Windows.Graphics.Display.DisplayOrientations.portraitFlipped:
                if (isMirrored) {
                    degreesToRotate = 90;
                } else {
                    degreesToRotate = 270;
                }
                break;
            default:
                degreesToRotate = 0;
                break;
        }

        switch (degreesToRotate) {
                // portrait
            case 90:
                rotation = Windows.Media.Capture.VideoRotation.clockwise90Degrees;
                currentPhotoOrientation = PhotoOrientation.clockwise90Degrees;
                break;
                // landscape
            case 0:
                rotation = Windows.Media.Capture.VideoRotation.none;
                currentPhotoOrientation = PhotoOrientation.none;
                break;
                // portrait-flipped
            case 270:
                rotation = Windows.Media.Capture.VideoRotation.clockwise270Degrees;
                currentPhotoOrientation = PhotoOrientation.clockwise270Degrees;
                break;
                // landscape-flipped
            case 180:
                rotation = Windows.Media.Capture.VideoRotation.clockwise180Degrees;
                currentPhotoOrientation = PhotoOrientation.clockwise180Degrees;
                break;
            default:
                // Falling back to portrait default
                rotation = Windows.Media.Capture.VideoRotation.clockwise90Degrees;
                currentPhotoOrientation = PhotoOrientation.clockwise90Degrees;
        }

        capture.setPreviewRotation(rotation);
        capture.setRecordRotation(rotation);

        return WinJS.Promise.as();
    }

    /**
     * Destroys camera preview, removes all elements created
     */
    function destroyCameraPreview() {
        capturePreview.pause();
        capturePreview.src = null;
        if (previewContainer) {
            document.body.removeChild(previewContainer);
            previewContainer = null;
        }
        if (capture) {
            try {
               capture.stopRecordAsync();
            } catch (e) {
               console.log(e);
            }
            
            capture = null;
        }
        Windows.Graphics.Display.DisplayInformation.getForCurrentView().removeEventListener("orientationchanged", updatePreviewForRotation, false);
    }

    return {
        /**
         * Initiate video capture using MediaCapture class
         * @param  {function} successCallback Called, when user clicked on preview, with captured file object
         * @param  {function} errorCallback   Called on any error
         */
        captureVideo: function (successCallback, errorCallback) {
            try {
                createCameraUI();
                startCameraPreview(function () {
                    // This callback called twice: whem video capture started and when it ended
                    // so we need to check capture status
                    if (!captureStarted) {
                        // remove cancel button and rename 'Take' button to 'Stop'
                        toggleElements('cancelCapture');
                        captureVideoCounter = 10;
                        document.getElementById('takePicture').innerText = translateService.instant('STOP') + ' (' + captureVideoCounter + ')';
                        document.getElementById('previewButtons').style.pointerEvents = 'none';

                        var encodingProperties = Windows.Media.MediaProperties.MediaEncodingProfile.createMp4(Windows.Media.MediaProperties.VideoEncodingQuality.hd720p),
                            generateUniqueCollisionOption = Windows.Storage.CreationCollisionOption.generateUniqueName,
                            localFolder = Windows.Storage.ApplicationData.current.localFolder;

                        localFolder.createFileAsync("cameraCaptureVideo.mp4", generateUniqueCollisionOption).done(function (capturedFile) {
                            capture.startRecordToStorageFileAsync(encodingProperties, capturedFile).done(function () {
                                capturedVideoFile = capturedFile;
                                captureStarted = true;

                                captureVideoInterval = setInterval(function () {
                                    captureVideoCounter = !captureVideoCounter ? 0 : captureVideoCounter - 1;
                                    document.getElementById('takePicture').innerText = translateService.instant('STOP') + ' (' + captureVideoCounter + ')';
                                    document.getElementById('previewButtons').style.pointerEvents = 'auto';
                                }, 1000);

                                captureVideoTimeout = setTimeout(function () {
                                    document.getElementById('previewButtons').style.pointerEvents = 'none';
                                    capture.stopRecordAsync().done(function () {
                                        clearInterval(captureVideoInterval);
                                        destroyCameraPreview();
                                        successCallback(capturedVideoFile);
                                    });
                                }, 10000);

                            }, function (err) {
                                destroyCameraPreview();
                                errorCallback(CaptureError.CAPTURE_INTERNAL_ERR, err);
                            });
                        }, function (err) {
                            destroyCameraPreview();
                            errorCallback(CaptureError.CAPTURE_INTERNAL_ERR, err);
                        });
                    } else {
                        document.getElementById('previewButtons').style.pointerEvents = 'none';
                        clearTimeout(captureVideoTimeout);
                        clearInterval(captureVideoInterval);
                        capture.stopRecordAsync().done(function () {
                            destroyCameraPreview();
                            successCallback(capturedVideoFile);
                        });
                    }
                }, function (err) {
                    destroyCameraPreview();
                    errorCallback(err);
                });
            } catch (ex) {
                destroyCameraPreview();
                errorCallback(CaptureError.CAPTURE_INTERNAL_ERR, ex);
            }
        },

        /**
         * Initiate image capture using MediaCapture class
         * @param  {function} successCallback Called, when user clicked on preview, with captured file object
         * @param  {function} errorCallback   Called on any error
         */
        capturePhoto: function (successCallback, errorCallback) {
            try {
                createCameraUI();
                startCameraPreview(
                    // Callback for Take button - captures intermediate image file.
                    function () {
                        document.getElementById('previewButtons').style.pointerEvents = 'none';


                        var inputStream = new Windows.Storage.Streams.InMemoryRandomAccessStream();
                        var uniqueFileName = Date.now() + "_cameraCaptureImage.jpg";

                        var encodingProperties = Windows.Media.MediaProperties.ImageEncodingProperties.createJpeg(),
                            overwriteCollisionOption = Windows.Storage.CreationCollisionOption.replaceExisting,
                            tempFolder = Windows.Storage.ApplicationData.current.temporaryFolder;

                        capture.capturePhotoToStreamAsync(encodingProperties, inputStream)
                            .done(function () {
                                return tempFolder.createFileAsync(uniqueFileName, overwriteCollisionOption)
                                    .done(function (file) {
                                        return reencodeAndSavePhotoAsync(inputStream, file, currentPhotoOrientation)
                                            .done(function () {
                                                capturedPictureFile = file;
                                                // show pre-captured image and toggle visibility of all buttons
                                                previewContainer.style.backgroundImage = 'url("' + 'ms-appdata:///temp/' + capturedPictureFile.name + '")';
                                                toggleElements('capturePreview', 'takePicture', 'cancelCapture', 'selectPicture', 'retakePicture');
                                                document.getElementById('previewButtons').style.pointerEvents = 'auto';
                                            }, closeCameraPreview);
                                    }, closeCameraPreview);;
                            }, closeCameraPreview);


                        function closeCameraPreview(err) {
                            destroyCameraPreview();
                            errorCallback(CaptureError.CAPTURE_INTERNAL_ERR, err)
                        }

                        function reencodeAndSavePhotoAsync(inputStream, file, orientation) {

                            var Imaging = Windows.Graphics.Imaging;
                            var bitmapDecoder = null,
                                bitmapEncoder = null,
                                outputStream = null;

                            return Imaging.BitmapDecoder.createAsync(inputStream)
                                .then(function (decoder) {
                                    bitmapDecoder = decoder;
                                    return file.openAsync(Windows.Storage.FileAccessMode.readWrite);
                                }).then(function (outStream) {
                                    outputStream = outStream;
                                    return Imaging.BitmapEncoder.createForTranscodingAsync(outputStream, bitmapDecoder);
                                }).then(function (encoder) {
									bitmapEncoder = encoder;
									if (orientation) {
										bitmapEncoder.bitmapTransform.rotation = orientation;
										var properties = new Imaging.BitmapPropertySet();
										properties.insert("System.Photo.Orientation", new Imaging.BitmapTypedValue(orientation, Windows.Foundation.PropertyType.uint16));
										return bitmapEncoder.bitmapProperties.setPropertiesAsync(properties)
									}
                                    
                                }).then(function () {
                                    return bitmapEncoder.flushAsync();
                                }).then(function () {
                                    inputStream.close();
                                    outputStream.close();
                                });
                        }
                    },
                    // error + cancel callback
                    function (err) {
                        destroyCameraPreview();
                        errorCallback(err);
                    },
                    // Callback for Select button - copies intermediate file into persistent application's storage
                    function () {
                        document.getElementById('previewButtons').style.pointerEvents = 'none';
                        var generateUniqueCollisionOption = Windows.Storage.CreationCollisionOption.generateUniqueName,
                            localFolder = Windows.Storage.ApplicationData.current.localFolder;

                        capturedPictureFile.copyAsync(localFolder, capturedPictureFile.name, generateUniqueCollisionOption).done(function (copiedFile) {
                            destroyCameraPreview();
                            successCallback(copiedFile);
                        }, function (err) {
                            destroyCameraPreview();
                            errorCallback(err);
                        });
                    },
                    // Callback for retake button - just toggles visibility of necessary elements
                    function () {
                        previewContainer.style.backgroundImage = '';
                        toggleElements('capturePreview', 'takePicture', 'cancelCapture', 'selectPicture', 'retakePicture');
                    }
                );
            } catch (ex) {
                destroyCameraPreview();
                errorCallback(CaptureError.CAPTURE_INTERNAL_ERR, ex);
            }
        }
    };
}

module.exports = {

    captureAudio: function (successCallback, errorCallback, args) {
        var options = args[0];

        var audioOptions = new CaptureAudioOptions();
        if (typeof (options.duration) == 'undefined') {
            audioOptions.duration = 3600; // Arbitrary amount, need to change later
        } else if (options.duration > 0) {
            audioOptions.duration = options.duration;
        } else {
            errorCallback(new CaptureError(CaptureError.CAPTURE_INVALID_ARGUMENT));
            return;
        }

        // Some shortcuts for long namespaces
        var CaptureNS = Windows.Media.Capture,
            MediaPropsNS = Windows.Media.MediaProperties,
            localAppData = Windows.Storage.ApplicationData.current.localFolder,
            generateUniqueName = Windows.Storage.NameCollisionOption.generateUniqueName;

        var mediaCapture = new CaptureNS.MediaCapture(),
            mediaCaptureSettings = new CaptureNS.MediaCaptureInitializationSettings(),
            mp3EncodingProfile = new MediaPropsNS.MediaEncodingProfile.createMp3(MediaPropsNS.AudioEncodingQuality.auto),
            m4aEncodingProfile = new MediaPropsNS.MediaEncodingProfile.createM4a(MediaPropsNS.AudioEncodingQuality.auto);

        mediaCaptureSettings.streamingCaptureMode = CaptureNS.StreamingCaptureMode.audio;

        var capturedFile,
            stopRecordTimeout;

        var stopRecord = function () {
            mediaCapture.stopRecordAsync().then(function () {
                capturedFile.getBasicPropertiesAsync().then(function (basicProperties) {
                    var result = new MediaFile(capturedFile.name, 'ms-appdata:///local/' + capturedFile.name, capturedFile.contentType, basicProperties.dateModified, basicProperties.size);
                    result.fullPath = capturedFile.path;
                    successCallback([result]);
                }, function () {
                    errorCallback(new CaptureError(CaptureError.CAPTURE_NO_MEDIA_FILES));
                });
            }, function () {
                errorCallback(new CaptureError(CaptureError.CAPTURE_NO_MEDIA_FILES));
            });
        };

        mediaCapture.initializeAsync(mediaCaptureSettings).done(function () {
            localAppData.createFileAsync("captureAudio.mp3", generateUniqueName).then(function (storageFile) {
                capturedFile = storageFile;
                mediaCapture.startRecordToStorageFileAsync(mp3EncodingProfile, capturedFile).then(function () {
                    stopRecordTimeout = setTimeout(stopRecord, audioOptions.duration * 1000);
                }, function (err) {
                    // -1072868846 is the error code for "No suitable transform was found to encode or decode the content."
                    // so we try to use another (m4a) format
                    if (err.number === -1072868846) {
                        // first we clear existing timeout to prevent success callback to be called with invalid arguments
                        // second we start same actions to try to record m4a audio
                        clearTimeout(stopRecordTimeout);
                        localAppData.createFileAsync("captureAudio.m4a", generateUniqueName).then(function (storageFile) {
                            capturedFile = storageFile;
                            mediaCapture.startRecordToStorageFileAsync(m4aEncodingProfile, capturedFile).then(function () {
                                stopRecordTimeout = setTimeout(stopRecord, audioOptions.duration * 1000);
                            }, function () {
                                // if we here, we're totally failed to record either mp3 or m4a
                                errorCallback(new CaptureError(CaptureError.CAPTURE_INTERNAL_ERR));
                                return;
                            });
                        });
                    } else {
                        errorCallback(new CaptureError(CaptureError.CAPTURE_INTERNAL_ERR));
                        return;
                    }
                });
            }, function () {
                errorCallback(new CaptureError(CaptureError.CAPTURE_NO_MEDIA_FILES));
            });
        });
    },

    captureImage: function (successCallback, errorCallback, args) {
        var CaptureNS = Windows.Media.Capture;

        function fail(code, data) {
            var err = new CaptureError(code);
            err.message = data;
            errorCallback(err);
        }

        var proxy = new MediaCaptureProxy();

        proxy.capturePhoto(function (photoFile) {
            photoFile.getBasicPropertiesAsync().done(function (basicProperties) {
                var result = new MediaFile(photoFile.name, 'ms-appdata:///local/' + photoFile.name, photoFile.contentType, basicProperties.dateModified, basicProperties.size);
                result.fullPath = photoFile.path;
                successCallback([result]);
            }, function (err) {
                fail(CaptureError.CAPTURE_INTERNAL_ERR, err);
            });
        }, function (err) {
            fail(err);
        });
    },

    captureVideo: function (successCallback, errorCallback, args) {
        var options = args[0];
        var CaptureNS = Windows.Media.Capture;

        function fail(code, data) {
            var err = new CaptureError(code);
            err.message = data;
            errorCallback(err);
        }

        var proxy = new MediaCaptureProxy();

        proxy.captureVideo(function (videoFile) {
            videoFile.getBasicPropertiesAsync().done(function (basicProperties) {
                var result = new MediaFile(videoFile.name, 'ms-appdata:///local/' + videoFile.name, videoFile.contentType, basicProperties.dateModified, basicProperties.size);
                result.fullPath = videoFile.path;
                successCallback([result]);
            }, function (err) {
                fail(CaptureError.CAPTURE_INTERNAL_ERR, err);
            });
        }, fail);
    },

    getFormatData: function (successCallback, errorCallback, args) {
        Windows.Storage.StorageFile.getFileFromPathAsync(args[0]).then(
            function (storageFile) {
                var mediaTypeFlag = String(storageFile.contentType).split("/")[0].toLowerCase();
                if (mediaTypeFlag === "audio") {
                    storageFile.properties.getMusicPropertiesAsync().then(function (audioProperties) {
                        successCallback(new MediaFileData(null, audioProperties.bitrate, 0, 0, audioProperties.duration / 1000));
                    }, function () {
                        errorCallback(new CaptureError(CaptureError.CAPTURE_INVALID_ARGUMENT));
                    });
                } else if (mediaTypeFlag === "video") {
                    storageFile.properties.getVideoPropertiesAsync().then(function (videoProperties) {
                        successCallback(new MediaFileData(null, videoProperties.bitrate, videoProperties.height, videoProperties.width, videoProperties.duration / 1000));
                    }, function () {
                        errorCallback(new CaptureError(CaptureError.CAPTURE_INVALID_ARGUMENT));
                    });
                } else if (mediaTypeFlag === "image") {
                    storageFile.properties.getImagePropertiesAsync().then(function (imageProperties) {
                        successCallback(new MediaFileData(null, 0, imageProperties.height, imageProperties.width, 0));
                    }, function () {
                        errorCallback(new CaptureError(CaptureError.CAPTURE_INVALID_ARGUMENT));
                    });
                } else {
                    errorCallback(new CaptureError(CaptureError.CAPTURE_INVALID_ARGUMENT));
                }
            },
            function () {
                errorCallback(new CaptureError(CaptureError.CAPTURE_INVALID_ARGUMENT));
            }
        );
    }
};

require("cordova/exec/proxy").add("Capture", module.exports);