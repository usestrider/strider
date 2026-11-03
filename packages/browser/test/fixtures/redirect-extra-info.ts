/** Captured Chromium 155 JSON redirect events, in their observed order. */
export default [
  {
    "kind": "event",
    "method": "Network.requestWillBeSent",
    "params": {
      "requestId": "1278706.4",
      "loaderId": "646B620176189090D9CAAA960E423BC8",
      "documentURL": "http://127.0.0.1:35141/cookie",
      "request": {
        "url": "http://127.0.0.1:35141/to-echo",
        "method": "POST",
        "headers": {
          "sec-ch-ua-platform": "\"Linux\"",
          "Referer": "http://127.0.0.1:35141/cookie",
          "User-Agent":
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/155.0.0.0 Safari/537.36",
          "sec-ch-ua": "\"Chromium\";v=\"155\", \"Not(A:Brand\";v=\"24\"",
          "content-type": "application/json",
          "sec-ch-ua-mobile": "?0"
        },
        "postData": "{\"q\":\"hats\"}",
        "hasPostData": true,
        "postDataEntries": [
          {
            "bytes": "eyJxIjoiaGF0cyJ9"
          }
        ],
        "mixedContentType": "none",
        "initialPriority": "High",
        "referrerPolicy": "strict-origin-when-cross-origin",
        "isSameSite": true
      },
      "timestamp": 772296.73795,
      "wallTime": 1793339194.843906,
      "initiator": {
        "type": "script",
        "stack": {
          "callFrames": [
            {
              "functionName": "",
              "scriptId": "3",
              "url": "",
              "lineNumber": 7,
              "columnNumber": 11
            }
          ]
        }
      },
      "redirectHasExtraInfo": false,
      "type": "Fetch",
      "frameId": "76F3487A52CF4F79FE4AD28961E44D32",
      "hasUserGesture": false
    }
  },
  {
    "kind": "event",
    "method": "Network.requestWillBeSentExtraInfo",
    "params": {
      "requestId": "1278706.4",
      "associatedCookies": [
        {
          "cookie": {
            "name": "flavor",
            "value": "oat",
            "domain": "127.0.0.1",
            "path": "/",
            "expires": -1,
            "size": 9,
            "httpOnly": false,
            "secure": false,
            "session": true,
            "priority": "Medium",
            "sourceScheme": "NonSecure",
            "sourcePort": 35141
          },
          "blockedReasons": [],
          "exemptionReason": "None"
        }
      ],
      "headers": {
        "Accept": "*/*",
        "Accept-Encoding": "gzip, deflate, br, zstd",
        "Accept-Language": "en-US,en;q=0.9",
        "Connection": "keep-alive",
        "Content-Length": "12",
        "Cookie": "flavor=oat",
        "Host": "127.0.0.1:35141",
        "Origin": "http://127.0.0.1:35141",
        "Referer": "http://127.0.0.1:35141/cookie",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/155.0.0.0 Safari/537.36",
        "content-type": "application/json",
        "sec-ch-ua": "\"Chromium\";v=\"155\", \"Not(A:Brand\";v=\"24\"",
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": "\"Linux\""
      },
      "connectTiming": {
        "requestTime": 772296.738233
      },
      "clientSecurityState": {
        "initiatorIsSecureContext": true,
        "initiatorIPAddressSpace": "Loopback",
        "localNetworkAccessRequestPolicy": "PermissionBlock"
      },
      "siteHasCookieInOtherPartition": false
    }
  },
  {
    "kind": "event",
    "method": "Network.responseReceivedExtraInfo",
    "params": {
      "requestId": "1278706.4",
      "blockedCookies": [],
      "headers": {
        "Connection": "keep-alive",
        "Date": "Fri, 30 Oct 2026 05:46:34 GMT",
        "Keep-Alive": "timeout=5",
        "Transfer-Encoding": "chunked",
        "access-control-allow-origin": "*",
        "location": "/echo"
      },
      "resourceIPAddressSpace": "Loopback",
      "statusCode": 307,
      "headersText":
        "HTTP/1.1 307 Temporary Redirect\r\nlocation: /echo\r\naccess-control-allow-origin: *\r\nDate: Fri, 30 Oct 2026 05:46:34 GMT\r\nConnection: keep-alive\r\nKeep-Alive: timeout=5\r\nTransfer-Encoding: chunked\r\n\r\n",
      "cookiePartitionKey": {
        "topLevelSite": "http://127.0.0.1",
        "hasCrossSiteAncestor": false
      },
      "cookiePartitionKeyOpaque": false,
      "exemptedCookies": []
    }
  },
  {
    "kind": "event",
    "method": "Network.requestWillBeSent",
    "params": {
      "requestId": "1278706.4",
      "loaderId": "646B620176189090D9CAAA960E423BC8",
      "documentURL": "http://127.0.0.1:35141/cookie",
      "request": {
        "url": "http://127.0.0.1:35141/echo",
        "method": "POST",
        "headers": {
          "User-Agent":
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/155.0.0.0 Safari/537.36",
          "Referer": "http://127.0.0.1:35141/cookie"
        },
        "postData": "{\"q\":\"hats\"}",
        "hasPostData": true,
        "postDataEntries": [
          {
            "bytes": "eyJxIjoiaGF0cyJ9"
          }
        ],
        "mixedContentType": "none",
        "initialPriority": "High",
        "referrerPolicy": "strict-origin-when-cross-origin",
        "isSameSite": true
      },
      "timestamp": 772296.738991,
      "wallTime": 1793339194.84494,
      "initiator": {
        "type": "other"
      },
      "redirectHasExtraInfo": true,
      "redirectResponse": {
        "url": "http://127.0.0.1:35141/to-echo",
        "status": 307,
        "statusText": "Temporary Redirect",
        "headers": {
          "Transfer-Encoding": "chunked",
          "access-control-allow-origin": "*",
          "location": "/echo",
          "Keep-Alive": "timeout=5",
          "Date": "Fri, 30 Oct 2026 05:46:34 GMT",
          "Connection": "keep-alive"
        },
        "mimeType": "",
        "charset": "",
        "connectionReused": true,
        "connectionId": 93,
        "remoteIPAddress": "127.0.0.1",
        "remotePort": 35141,
        "fromDiskCache": false,
        "fromServiceWorker": false,
        "fromPrefetchCache": false,
        "encodedDataLength": 196,
        "timing": {
          "requestTime": 772296.738233,
          "proxyStart": -1,
          "proxyEnd": -1,
          "dnsStart": -1,
          "dnsEnd": -1,
          "connectStart": -1,
          "connectEnd": -1,
          "sslStart": -1,
          "sslEnd": -1,
          "workerStart": -1,
          "workerReady": -1,
          "workerFetchStart": -1,
          "workerRespondWithSettled": -1,
          "sendStart": 0.106,
          "sendEnd": 0.134,
          "pushStart": 0,
          "pushEnd": 0,
          "receiveHeadersStart": 0.509,
          "receiveHeadersEnd": 0.525
        },
        "responseTime": 1793339194844.68,
        "protocol": "http/1.1",
        "alternateProtocolUsage": "unspecifiedReason",
        "securityState": "secure"
      },
      "type": "Fetch",
      "frameId": "76F3487A52CF4F79FE4AD28961E44D32",
      "hasUserGesture": false
    }
  },
  {
    "kind": "event",
    "method": "Network.requestWillBeSentExtraInfo",
    "params": {
      "requestId": "1278706.4",
      "associatedCookies": [
        {
          "cookie": {
            "name": "flavor",
            "value": "oat",
            "domain": "127.0.0.1",
            "path": "/",
            "expires": -1,
            "size": 9,
            "httpOnly": false,
            "secure": false,
            "session": true,
            "priority": "Medium",
            "sourceScheme": "NonSecure",
            "sourcePort": 35141
          },
          "blockedReasons": [],
          "exemptionReason": "None"
        }
      ],
      "headers": {
        "Accept": "*/*",
        "Accept-Encoding": "gzip, deflate, br, zstd",
        "Accept-Language": "en-US,en;q=0.9",
        "Connection": "keep-alive",
        "Content-Length": "12",
        "Cookie": "flavor=oat",
        "Host": "127.0.0.1:35141",
        "Origin": "http://127.0.0.1:35141",
        "Referer": "http://127.0.0.1:35141/cookie",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/155.0.0.0 Safari/537.36",
        "content-type": "application/json",
        "sec-ch-ua": "\"Chromium\";v=\"155\", \"Not(A:Brand\";v=\"24\"",
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": "\"Linux\""
      },
      "connectTiming": {
        "requestTime": 772296.739107
      },
      "clientSecurityState": {
        "initiatorIsSecureContext": true,
        "initiatorIPAddressSpace": "Loopback",
        "localNetworkAccessRequestPolicy": "PermissionBlock"
      },
      "siteHasCookieInOtherPartition": false
    }
  },
  {
    "kind": "event",
    "method": "Network.responseReceivedExtraInfo",
    "params": {
      "requestId": "1278706.4",
      "blockedCookies": [],
      "headers": {
        "Connection": "keep-alive",
        "Date": "Fri, 30 Oct 2026 05:46:34 GMT",
        "Keep-Alive": "timeout=5",
        "Transfer-Encoding": "chunked",
        "access-control-allow-origin": "*",
        "content-type": "application/json"
      },
      "resourceIPAddressSpace": "Loopback",
      "statusCode": 200,
      "headersText":
        "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\naccess-control-allow-origin: *\r\nDate: Fri, 30 Oct 2026 05:46:34 GMT\r\nConnection: keep-alive\r\nKeep-Alive: timeout=5\r\nTransfer-Encoding: chunked\r\n\r\n",
      "cookiePartitionKey": {
        "topLevelSite": "http://127.0.0.1",
        "hasCrossSiteAncestor": false
      },
      "cookiePartitionKeyOpaque": false,
      "exemptedCookies": []
    }
  },
  {
    "kind": "event",
    "method": "Network.responseReceived",
    "params": {
      "requestId": "1278706.4",
      "loaderId": "646B620176189090D9CAAA960E423BC8",
      "timestamp": 772296.739784,
      "type": "Fetch",
      "response": {
        "url": "http://127.0.0.1:35141/echo",
        "status": 200,
        "statusText": "OK",
        "headers": {
          "Transfer-Encoding": "chunked",
          "access-control-allow-origin": "*",
          "Keep-Alive": "timeout=5",
          "Date": "Fri, 30 Oct 2026 05:46:34 GMT",
          "content-type": "application/json",
          "Connection": "keep-alive"
        },
        "mimeType": "application/json",
        "charset": "",
        "connectionReused": true,
        "connectionId": 93,
        "remoteIPAddress": "127.0.0.1",
        "remotePort": 35141,
        "fromDiskCache": false,
        "fromServiceWorker": false,
        "fromPrefetchCache": false,
        "encodedDataLength": 195,
        "timing": {
          "requestTime": 772296.739107,
          "proxyStart": -1,
          "proxyEnd": -1,
          "dnsStart": -1,
          "dnsEnd": -1,
          "connectStart": -1,
          "connectEnd": -1,
          "sslStart": -1,
          "sslEnd": -1,
          "workerStart": -1,
          "workerReady": -1,
          "workerFetchStart": -1,
          "workerRespondWithSettled": -1,
          "sendStart": 0.09,
          "sendEnd": 0.113,
          "pushStart": 0,
          "pushEnd": 0,
          "receiveHeadersStart": 0.361,
          "receiveHeadersEnd": 0.378
        },
        "responseTime": 1793339194845.407,
        "protocol": "http/1.1",
        "alternateProtocolUsage": "unspecifiedReason",
        "securityState": "unknown"
      },
      "hasExtraInfo": true,
      "frameId": "76F3487A52CF4F79FE4AD28961E44D32"
    }
  },
  {
    "kind": "event",
    "method": "Network.dataReceived",
    "params": {
      "requestId": "1278706.4",
      "timestamp": 772296.740335,
      "dataLength": 693,
      "encodedDataLength": 705
    }
  },
  {
    "kind": "event",
    "method": "Network.loadingFinished",
    "params": {
      "requestId": "1278706.4",
      "timestamp": 772296.739641,
      "encodedDataLength": 900
    }
  }
]
