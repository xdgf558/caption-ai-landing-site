(function (game) {
  var API_BASES = [
    "https://blockstream.info/api",
    "https://mempool.space/api",
  ];

  function requestFromBases(path, responseType) {
    var errors = [];

    return API_BASES.reduce(function (chain, baseUrl) {
      return chain.catch(function () {
        return fetch(baseUrl + path)
          .then(function (response) {
            if (!response.ok) {
              throw new Error("HTTP " + response.status);
            }
            return responseType === "text" ? response.text() : response.json();
          })
          .catch(function (error) {
            errors.push(baseUrl + path + " -> " + error.message);
            throw error;
          });
      });
    }, Promise.reject(new Error("init"))).catch(function () {
      throw new Error(errors.join(" | ") || "Bitcoin API unavailable");
    });
  }

  function fetchText(path) {
    return requestFromBases(path, "text");
  }

  function fetchJson(path) {
    return requestFromBases(path, "json");
  }

  function fetchTipHeight() {
    return fetchText("/blocks/tip/height").then(function (value) {
      return Number(value || 0);
    });
  }

  function fetchBlockHashByHeight(height) {
    return fetchText("/block-height/" + height).then(function (hash) {
      return String(hash || "").trim();
    });
  }

  function fetchBlockByHash(hash) {
    return fetchJson("/block/" + hash).then(function (block) {
      return {
        hash: block.id || hash,
        height: Number(block.height || 0),
        timestamp: Number(block.timestamp || 0),
      };
    });
  }

  function fetchBlockByHeight(height) {
    return fetchBlockHashByHeight(height).then(function (hash) {
      if (!hash) {
        throw new Error("Missing block hash at height " + height);
      }
      return fetchBlockByHash(hash);
    });
  }

  function getTargetUtcTimestamp(drawDate) {
    return Math.floor(new Date(drawDate + "T00:00:00Z").getTime() / 1000);
  }

  function findFirstBlockAtOrAfter(drawDate) {
    var targetTimestamp = getTargetUtcTimestamp(drawDate);
    var blockCache = {};

    function getBlock(height) {
      if (blockCache[height]) {
        return Promise.resolve(blockCache[height]);
      }

      return fetchBlockByHeight(height).then(function (block) {
        blockCache[height] = block;
        return block;
      });
    }

    return fetchTipHeight().then(function (tipHeight) {
      var low = 0;
      var high = tipHeight;

      function search() {
        if (low >= high) {
          return Promise.resolve(low);
        }

        var mid = Math.floor((low + high) / 2);
        return getBlock(mid).then(function (block) {
          if (block.timestamp >= targetTimestamp) {
            high = mid;
          } else {
            low = mid + 1;
          }
          return search();
        });
      }

      return search().then(function (candidateHeight) {
        var currentHeight = candidateHeight;

        function moveBackward() {
          if (currentHeight <= 0) {
            return Promise.resolve();
          }
          return getBlock(currentHeight - 1).then(function (block) {
            if (block.timestamp >= targetTimestamp) {
              currentHeight -= 1;
              return moveBackward();
            }
            return null;
          });
        }

        function moveForward() {
          return getBlock(currentHeight).then(function (block) {
            if (block.timestamp >= targetTimestamp) {
              return block;
            }
            currentHeight += 1;
            if (currentHeight > tipHeight) {
              throw new Error("No block found at or after UTC date " + drawDate);
            }
            return moveForward();
          });
        }

        return moveBackward().then(moveForward);
      });
    });
  }

  game.utils.bitcoinApi = {
    fetchTipHeight: fetchTipHeight,
    fetchBlockByHeight: fetchBlockByHeight,
    findFirstBlockAtOrAfter: findFirstBlockAtOrAfter,
  };
})(window.CatGame);
