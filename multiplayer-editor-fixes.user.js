// ==UserScript==
// @name        multiplayer-editor-player-fixes
// @namespace   https://github.com/zangixd/krunker-scripts
// @match       https://krunker.io/editor.html*
// @grant       unsafeWindow
// @version     1.2
// @author      github.com/zangixd
// @description 09/02/2026, 22:11:38
// @require     https://unpkg.com/three@0.140.0/build/three.min.js
// @require     https://unpkg.com/three@0.140.0/examples/js/loaders/OBJLoader.js
// @run-at      document-start
// ==/UserScript==

(function (window) {
  'use strict';

  const css = `
    .joinButton {
      width: fit-content;
      height: fit-content;
      background: #db00db;
      margin-left: 10px;
      margin-top: 0;
      margin-bottom: 0;
      transform: scale(0.9);
    }

    .vector3 input[type=text] {
      padding:4px;
      border-radius:4px;
      font-size:10px;
      background-color:#bbb
    }
  `;

  const hookGetter = (object, propertyName, setter) => {
    let _actual;
    Object.defineProperty(object, propertyName, {
      get: () => _actual,
      set: (e) => {
        _actual = setter(e);
      }
    });
  };

  let isHostingMap = false;
  hookGetter(window, 'KE', (_KE) => {
    if (_KE.testMap) {
      const testmapfn = _KE.testMap.bind(_KE);
      _KE.testMap = (notSandbox, ...args) => {
        console.log('EditorFeatures: testMap was called');
        if (notSandbox) {
          isHostingMap = true;
        }
        return testmapfn(notSandbox, ...args);
      }
    } else {
      console.log('EditorFeatures Error: Could not override testMap as it was not present')
    }

    hookGetter(_KE, 'multiplayer', (e) => {
      let patchedMPClass = e;

      try {
        patchedMPClass = patchMultiplayerClass(patchedMPClass);

        if (patchedMPClass) {
          console.log('EditorFeatures: Multiplayer class patched');
        } else {
          patchedMPClass = e;
        }
      } catch (error) {
        console.log('EditorFeatures Error: Could not patch multiplayer class:', error);
      }

      return patchedMPClass;
    });

    console.log('EditorFeatures: KE override success');

    return _KE;
  });

  // window.open hook to get hosted map game url
  const openWin = window.open;
  window.open = (...args) => {
    const newWin = openWin(...args);
    if (
      isHostingMap &&
      window.KE.multiplayer.room &&
      localStorage.getItem('custToLoad') &&
      newWin
    ) {
      isHostingMap = false;
      console.log('EditorFeatures: detected map hosting');

      let pollingFinished = false;
      let poll = setInterval(() => {
        if (pollingFinished) return;

        if (newWin.closed) {
          pollingFinished = true;
          return clearInterval(poll);
        }

        if (newWin.getGameActivity) {
          const act = newWin.getGameActivity();
          if (act.id && act.custom && act.map === KE.mapConfig.name) {
            pollingFinished = true;
            KE.multiplayer.sendChatMessage(`Hosted: ${act.id}`);
            console.log('Game host message sent: ' + act.id);
            return clearInterval(poll);
          }
        }

      }, 1e3);
    }
    return newWin;
  };

  const loader = new THREE.OBJLoader();
  let modelMesh = null;

  loader.load('https://assets.krunker.io/models/spawn_0.obj', (obj) => {
    modelMesh = obj.children.find(c => c.isMesh);
  });

  function setPlayerModel(model) {
    const color = model.material.color;
    const opacity = model.material.opacity;

    // Tween position
    model.posTween = undefined;
    model.position.setOrig = model.position.set;
    model.position.set = function (x, y, z) {
      model.posTween?.stop();
      let modelPos = model.position;

      const positions = {
        x: modelPos.x,
        y: modelPos.y + 10,
        z: modelPos.z
      };

      model.posTween = new TWEEN.Tween(positions)
        .to(new KE.THREE.Vector3(x, y, z), 120 * 3)
        .easing(TWEEN.Easing.Sinusoidal.Out)
        .onUpdate(() => model.position.setOrig(positions.x, positions.y - 10, positions.z))
        .onComplete(() => model.posTween = undefined)
        .start();
    }

    // Tween rotation. Also removes horrid x and z rotations
    model.rotTween = undefined;
    model.rotation.setOrig = model.rotation.set;
    model.rotation.set = function (x, y, z) {
      model.rotTween?.stop();

      const quat = new KE.THREE.Quaternion().setFromEuler(
        new THREE.Euler(x, y, z, model.rotation.order)
      );

      const direction = new THREE.Vector3(0, 0, 1).applyQuaternion(quat);
      direction.y = 0;
      direction.normalize();

      const rawYaw = Math.atan2(direction.x, direction.z);
      const currentYaw = model.rotation.y;
      const delta = (((rawYaw - currentYaw) + Math.PI) % (Math.PI * 2)) - Math.PI;
      const targetYaw = currentYaw + delta;


      const rotations = {
        y: model.rotation.y
      };

      model.rotTween = new TWEEN.Tween(rotations)
        .to({ y: targetYaw }, 120 * 3)
        .easing(TWEEN.Easing.Sinusoidal.Out)
        .onUpdate(() => model.rotation.setOrig(0, rotations.y, 0))
        .onComplete(() => (model.rotTween = undefined))
        .start();
    };

    // Replace geometry with player model geometry
    model.geometry.dispose();
    model.geometry = modelMesh.geometry.clone();

    // Replace material with player model material
    model.material.dispose();
    const newMat = [];
    modelMesh.material.forEach(mat => newMat.push(mat.clone()));
    newMat.forEach(mat => {
      mat.opacity = opacity;
      mat.transparency = opacity < 1;
      mat.color.set(color);
      mat.fog = false;
    });
    model.material = newMat;

    // Make sprite not scale with distance and configure its positionand material
    const sprite = model.children[0];
    sprite.material.fog = false;
    sprite.position.y = 12;
    sprite.onBeforeRender = function () {
      let vector = new KE.THREE.Vector3();
      KE.camera.getWorldPosition(vector);

      let distance = sprite.parent.position.distanceTo(vector) / 20;
      let maxDistance = Math.max(4, distance);
      sprite.scale.x = sprite.material.map.width * 0.006 * maxDistance;
      sprite.scale.y = sprite.material.map.height * 0.006 * maxDistance;
    }
  }

  // patches player model
  function patchMultiplayerClass(instance) {
    if (!(
      instance &&
      instance.playerManager &&
      instance.playerManager.addPlayer &&
      instance.onChat
    )) return console.log('EditorFeatures Error: Could not patch multiplayer class as required values were not present');

    const addPlayerFn = instance.playerManager.addPlayer.bind(instance.playerManager);
    instance.playerManager.addPlayer = (pinfo, isLocal, ...x) => {
      const val = addPlayerFn(pinfo, isLocal, ...x);
      if (!isLocal) {
        try {
          setPlayerModel(val.model);
        } catch (error) {
          console.log('EditorFeatures Error: Could not set player model:', error);
        }
      }
      return val;
    }

    return instance;
  }

  // patches GUI input handler
  function patchInputUpdateHandler() {
    if (!(
      GUI &&
      GUI.update &&
      GUI.update.number && 
      GUI.update.number.change
    )) return console.log('EditorFeatures Error: GUI not yet initialized/ready');

    GUI.update.number.change = (el) => {
        if (el.value === '') el.value = 0;
        
        let evalValue;
        try {
            evalValue = Function(`'use strict'; return (${el.value})`)();
        } catch {}

        el.value = (Number.isFinite(evalValue) ? evalValue : 0).toString();
    }
  }

  window.document.addEventListener('DOMContentLoaded', () => {
    document.head.appendChild(document.createElement('style')).appendChild(document.createTextNode(css));
    patchInputUpdateHandler();

    const chatList = window.document.getElementById('mp-chat-list');
    const rightPanel = window.document.getElementById('panel_right_blank');

    // add the Join button to 'hosted map' chat messages
    function handleChatMutation() {
      const latestMessage = chatList.children[chatList.children.length - 1];

      if (latestMessage.children.length === 2) { // not a system message
        const messageElement = latestMessage.children[1];
        const message = messageElement.innerHTML;

        if (message.startsWith('Hosted: ')) {
          const SplitMapID = message.replace('Hosted: ', '').split(':');

          if (
            SplitMapID.length === 2 &&
            // currently region ids length is either 2 or 3 (ny, mbi etc.)
            (SplitMapID[0].length == 2 || SplitMapID[0].length == 3) &&
            SplitMapID[1].length === 5 // game id length is 5 for now
          ) {
            // this is a valid game host message, a button should be added

            const joinThisButton = document.createElement('button');

            joinThisButton.classList.add('eButton', 'joinButton');
            joinThisButton.innerHTML = 'Join';
            messageElement.insertAdjacentElement('afterend', joinThisButton);

            joinThisButton.onclick = () => {
              window.open('https://krunker.io/?game=' + SplitMapID.join(':'));
            };

          }

        }

      }
    }

    // change input types to text for transform input elements
    function handleRightPanelMutation() {
      if (!(
        rightPanel &&
        rightPanel.children &&
        rightPanel.children.transformB &&
        rightPanel.children.transformB.children
      )) return;

      rightPanel.children.transformB.children.forEach(child => {
          if (child.className === 'vector3') child.children.forEach(subChild => {
              subChild.type = 'text';
          })
      })
    }

    const observer = new MutationObserver((mutations) => {
      const mutatedEl = mutations[0].target;
      if (mutatedEl.id === chatList.id) {
        handleChatMutation();
      } else if (mutatedEl.id === rightPanel.id) {
        handleRightPanelMutation(mutations);
      }
    });

    observer.observe(
      chatList,
      { attributes: true, childList: true, subtree: true }
    );

    observer.observe(
      rightPanel,
      { attributes: true, childList: true, subtree: true }
    );

    console.log('EditorFeatures: chat list observer setup.');
  })
})(
  (typeof unsafeWindow === 'undefined' ? () => { return window } : () => { return unsafeWindow })()
);