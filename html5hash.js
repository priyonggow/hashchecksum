$().ready(function () {

    /*
     * Helpers
     */

    getUnique = function () {
        var uniquecnt = 0;

        function getUnique() {
            return (uniquecnt++);
        }

        return getUnique;
    }();

    function decimalToHexString(number) {
        if (number < 0) {
            number = 0xFFFFFFFF + number + 1;
        }

        return number.toString(16);
    }

    function digits(number, dig) {
        var shift = Math.pow(10, dig);
        return Math.floor(number * shift) / shift;
    }

    function escapeHtml(text) {
        return $('<div/>').text(text).html();
    }

    function swapendian32(val) {
        return (((val & 0xFF) << 24) |
            ((val & 0xFF00) << 8) |
            ((val >> 8) & 0xFF00) |
            ((val >> 24) & 0xFF)) >>> 0;

    }

    /*
     * Horribly inefficient but unless I find another library or
     * (re)write stuff this is the way that just makes it work (TM).
     *
     * Note: Since CryptoJS 3.1 this functionality is in the framework.
     *       However it's currently slower than this juding from my tests.
     *       See CryptoJS components/lib-typedarrays.js
     */
    function arrayBufferToWordArray(arrayBuffer) {
        var fullWords = Math.floor(arrayBuffer.byteLength / 4);
        var bytesLeft = arrayBuffer.byteLength % 4;

        var u32 = new Uint32Array(arrayBuffer, 0, fullWords);
        var u8 = new Uint8Array(arrayBuffer);

        var cp = [];
        for (var i = 0; i < fullWords; ++i) {
            cp.push(swapendian32(u32[i]));
        }

        if (bytesLeft) {
            var pad = 0;
            for (var i = bytesLeft; i > 0; --i) {
                pad = pad << 8;
                pad += u8[u8.byteLength - i];
            }

            for (var i = 0; i < 4 - bytesLeft; ++i) {
                pad = pad << 8;
            }

            cp.push(pad);
        }

        return CryptoJS.lib.WordArray.create(cp, arrayBuffer.byteLength);
    };

    function bytes2si(bytes, outputdigits) {
        if (bytes < 1024) { // Bytes
            return digits(bytes, outputdigits) + " b";
        } else if (bytes < 1048576) { // KiB
            return digits(bytes / 1024, outputdigits) + " KiB";
        }

        return digits(bytes / 1048576, outputdigits) + " MiB";
    }

    function bytes2si2(bytes1, bytes2, outputdigits) {
        var big = Math.max(bytes1, bytes2);

        if (big < 1024) { // Bytes
            return bytes1 + "/" + bytes2 + " b";
        } else if (big < 1048576) { // KiB
            return digits(bytes1 / 1024, outputdigits) + "/" +
                digits(bytes2 / 1024, outputdigits) + " KiB";
        }

        return digits(bytes1 / 1048576, outputdigits) + "/" +
            digits(bytes2 / 1048576, outputdigits) + " MiB";
    }

    function progressiveRead(file, work, done) {
        var chunkSize = 20480; // 20KiB at a time
        var pos = 0;
        var reader = new FileReader();

        function progressiveReadNext() {
            var end = Math.min(pos + chunkSize, file.size);

            reader.onload = function (e) {
                pos = end;
                work(e.target.result, pos, file);
                if (pos < file.size) {
                    setTimeout(progressiveReadNext, 0);
                } else {
                    // Done
                    done(file);
                }
            }

            if (file.slice) {
                var blob = file.slice(pos, end);
            } else if (file.webkitSlice) {
                var blob = file.webkitSlice(pos, end);
            }
            reader.readAsArrayBuffer(blob);
        }

        setTimeout(progressiveReadNext, 0);
    };

    // List all CryptoJS based supported algorithms so we can handle them
    // in one codepath. We could also use this to dynamically add these
    // options to the UI but this might prevent search engines from properly
    // picking them up.

    var algorithms = [{
            name: "MD5",
            type: CryptoJS.algo.MD5
        },
        {
            name: "SHA1",
            type: CryptoJS.algo.SHA1
        },
        {
            name: "SHA256",
            type: CryptoJS.algo.SHA256
        },
        {
            name: "SHA512",
            type: CryptoJS.algo.SHA512
        },
        {
            name: "SHA3-224",
            type: CryptoJS.algo.SHA3,
            param: {
                outputLength: 224
            }
        },
        {
            name: "SHA3-256",
            type: CryptoJS.algo.SHA3,
            param: {
                outputLength: 256
            }
        },
        {
            name: "SHA3-384",
            type: CryptoJS.algo.SHA3,
            param: {
                outputLength: 384
            }
        },
        {
            name: "SHA3-512",
            type: CryptoJS.algo.SHA3,
            param: {
                outputLength: 512
            }
        },
        {
            name: "RIPEMD-160",
            type: CryptoJS.algo.RIPEMD160
        }
    ];

    function handleFileSelect(evt) {
        evt.stopPropagation();
        evt.preventDefault();
        if (evt.target.files) {
            var files = evt.target.files;
        } else {
            var files = evt.dataTransfer.files; // FileList object.
        }

        for (var i = 0, f; f = files[i]; i++) {

            (function () {
                var start = (new Date).getTime();
                var lastprogress = 0;

                var enabledAlgorithms = [];
                for (var j = 0; j < algorithms.length; j++) {
                    var current = algorithms[j];
                    if ($('[name="' + current.name + '-switch"]').prop("checked")) {
                        // Param will not exist for some but that's ok
                        var algoInst = {
                            name: current.name,
                            instance: current.type.create(current.param)
                        };
                        enabledAlgorithms.push(algoInst);
                    }
                }

                // Special case CRC32 as it's not part of CryptoJS and takes another input format.
                var doCRC32 = $('[name="crc32switch"]').prop("checked");

                if (doCRC32) var crc32intermediate = 0;

                var uid = "filehash" + getUnique();

                $("#list").append('<div id="' + uid + '" class="col-md-12">' +
                    '<b><div class="form-group"><label for="name">File Name</label><input type="text" class="form-control" id="name" value="' + escapeHtml(f.name) + '"></div><span class="progresstext"></span></b>' +
                    '<div class="progress"></div>' +
                    '</div>');

                progressiveRead(f,
                    function (data, pos, file) {
                        // Work
                        if (enabledAlgorithms.length > 0) {
                            // Easiest way to get this up and running ;-) Obvious optimization potential there.
                            var wordArray = arrayBufferToWordArray(data);
                        }

                        for (var j = 0; j < enabledAlgorithms.length; j++) {
                            enabledAlgorithms[j].instance.update(wordArray);
                        }

                        if (doCRC32) crc32intermediate = crc32(new Uint8Array(data), crc32intermediate);

                        // Update progress display
                        var progress = Math.floor((pos / file.size) * 100);
                        if (progress > lastprogress) {
                            var took = ((new Date).getTime() - start) / 1000;

                            if (took > 0.1) // Only show progressbar after 100ms so it won't show for very small files
                                $("#" + uid + " .progress").progressbar({
                                    value: progress
                                });

                            $("#" + uid + " .progresstext").html('<div class="form-row"><div class="form-group col-md-4"><label for="size">File size</label><input type="text" class="form-control" value="' +
                                bytes2si2(pos, file.size, 2) + '"></div><div class="form-group col-md-2"><label for="size">time</label><input type="text" class="form-control" value="' + bytes2si(pos / took, 2) + '/s "></div></div>');

                            lastprogress = progress;
                        }
                    },
                    function (file) {
                        // Done
                        var took = ((new Date).getTime() - start) / 1000;

                        var results = '<br><div class="form-row">';

                        if (doCRC32) results += '<br><div class="form-group col-md-2"><label for="type">Type</label><input type="text" class="form-control" id="type" value="CRC-32"></div><div class="form-group col-md-10"><label for="hash">Hash</label><input type="text" class="form-control" id="hash" value="' + decimalToHexString(crc32intermediate) + '"></div>';

                        for (var j = 0; j < enabledAlgorithms.length; j++) {
                            results += '<br><div class="form-group col-md-2 card-title"><label for="type">Type</label><input type="text" class="form-control" id="type" value="' + enabledAlgorithms[j].name + '"></div><div class="form-group col-md-10 card-title"><label for="hash">Hash</label><input type="text" class="form-control" id="hash" value="' + enabledAlgorithms[j].instance.finalize() + '"></div>';
                        }

                        results += '</div>';

                        results += '<small><div class="card border-success mb-3" style="max-width: 18rem;"><p class="card-text">Time taken: ' + digits(took, 2) + ' s @ ' + bytes2si(file.size / took, 2) + '/s</p></div></small><br />';

                        $("#" + uid).append(results);

                        $("#" + uid + " .progress")
                            .hide('slow');

                        $("#" + uid)
                            .css('background-color', '');
                    });
            })();
        };

    }

    function handleDragOver(evt) {
        evt.stopPropagation();
        evt.preventDefault();
        evt.dataTransfer.dropEffect = 'copy'; // Explicitly show this is a copy.
    }

    function triggerFileSelection(node) {
        $("#hiddenFilesSelector").click();
    }

    function compatible() {
        try {
            // Check for FileApi
            if (typeof FileReader == "undefined") return false;

            // Check for Blob and slice api
            if (typeof Blob == "undefined") return false;
            var blob = new Blob();
            if (!blob.slice && !blob.webkitSlice) return false;

            // Check for Drag-and-drop
            if (!('draggable' in document.createElement('span'))) return false;
        } catch (e) {
            return false;
        }
        return true;
    }

    (function () {
        var po = document.createElement('script');
        po.type = 'text/javascript';
        po.async = true;
        po.src = 'https://apis.google.com/js/plusone.js';
        var s = document.getElementsByTagName('script')[0];
        s.parentNode.insertBefore(po, s);
    })();

    if (!compatible()) {
        $("#nojavascript").hide();

        // Fade in incompatibility note
        $("#overlay")
            .css('opacity', 0)
            .animate({
                opacity: 0.8
            }, 2000)

        $("#overlaytextbox")
            .css('opacity', 0)
            .animate({
                opacity: 1.0
            }, 2000)

        $("#missingfeatures").html(
            "HTML5HASH does not work with this browser. Consider using one of these: \
            <div id=\"browserads\"> \
            <div class=\"browserad\"> \
                    <a href=\"http://affiliates.mozilla.org/link/banner/21269\"> \
                        <img src=\"http://affiliates.mozilla.org/media/uploads/banners/f5eeeddc214ed8ef15e48bc80e1f53b0da4f0574.png\" alt=\"Download: Fast, Fun, Awesome\" /> \
                    </a> \
            </div> \
            <div class=\"browserad\"> \
                    <a href=\"http://www.google.com/chrome/\"> \
                        <img src=\"img/chrome_logo.png\" alt=\"Google Chrome\" /> \
                    </a> \
            </div> \
        </div>");

        return; // Nevermind initialising the handlers
    }

    // Hide incompatibility warning
    $("#overlay").hide();
    $("#overlaytextbox").hide();
    // Setup the dnd listeners.
    var dropZone = document.getElementById('drop_zone');
    dropZone.addEventListener('dragover', handleDragOver, false);
    dropZone.addEventListener('drop', handleFileSelect, false);

    // Setup browse listener
    var fileSelector = document.getElementById('hiddenFilesSelector');
    fileSelector.addEventListener('change', handleFileSelect, false);


});