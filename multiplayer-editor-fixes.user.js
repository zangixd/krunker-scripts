// ==UserScript==
// @name        multiplayer-editor-player-fixes
// @namespace   Violentmonkey Scripts
// @match       https://krunker.io/editor.html*
// @grant       none
// @version     1.1
// @author      -
// @description 09/02/2026, 22:11:38
// @require     https://unpkg.com/three@0.140.0/build/three.min.js
// @require     https://unpkg.com/three@0.140.0/examples/js/loaders/OBJLoader.js
// ==/UserScript==

(function() {
  'use strict';

  const loader = new THREE.OBJLoader();
  let modelMesh = null;

  loader.load('https://assets.krunker.io/models/spawn_0.obj', (obj) => {
    modelMesh = obj.children.find(c => c.isMesh);
  });

  const pushOrig = Array.prototype.push;
  Array.prototype.push = function(...args) {
    if (this === window.KE.scene.children && modelMesh) {
      for (const child of args) {
        if (child.name && child.name.includes('mp_player_')) {
          const color = child.material.color;
          const opacity = child.material.opacity;

          // Tween position
          child.posTween = undefined;
          child.position.setOrig = child.position.set;
          child.position.set = function(x, y, z) {
            child.posTween?.stop();
            let modelPos = child.position;

            const positions = {
              x: modelPos.x,
              y: modelPos.y + 10,
              z: modelPos.z
            };

            child.posTween = new TWEEN.Tween(positions)
              .to(new KE.THREE.Vector3(x, y, z), 120 * 3)
              .easing(TWEEN.Easing.Sinusoidal.Out)
              .onUpdate(() => child.position.setOrig(positions.x, positions.y - 10, positions.z))
              .onComplete(() => child.posTween = undefined)
              .start();
          }

          // Tween rotation. Also removes horrid x and z rotations
          child.rotTween = undefined;
          child.rotation.setOrig = child.rotation.set;
          child.rotation.set = function (x, y, z) {
            child.rotTween?.stop();

            const quat = new KE.THREE.Quaternion().setFromEuler(
              new THREE.Euler(x, y, z, child.rotation.order)
            );

            const direction = new THREE.Vector3(0, 0, 1).applyQuaternion(quat);
            direction.y = 0;
            direction.normalize();

            const rawYaw = Math.atan2(direction.x, direction.z);
            const currentYaw = child.rotation.y;
            const delta = (((rawYaw - currentYaw) + Math.PI) % (Math.PI * 2)) - Math.PI;
            const targetYaw = currentYaw + delta;


            const rotations = {
              y: child.rotation.y
            };

            child.rotTween = new TWEEN.Tween(rotations)
              .to({ y: targetYaw }, 120 * 3)
              .easing(TWEEN.Easing.Sinusoidal.Out)
              .onUpdate(() => child.rotation.setOrig(0, rotations.y, 0))
              .onComplete(() => (child.rotTween = undefined))
              .start();
          };

          // Replace geometry with player model geometry
          child.geometry.dispose();
          child.geometry = modelMesh.geometry.clone();

          // Replace material with player model material
          child.material.dispose();
          const newMat = [];
          modelMesh.material.forEach(mat => newMat.push(mat.clone()));
          newMat.forEach(mat => {
            mat.opacity = opacity;
            mat.transparency = opacity < 1;
            mat.color.set(color);
            mat.fog = false;
          });
          child.material = newMat;

          // Make sprite not scale with distance and configure its positionand material
          const sprite = child.children[0];
          sprite.material.fog = false;
          sprite.position.y = 12;
          sprite.onBeforeRender = function() {
            let vector = new KE.THREE.Vector3();
            KE.camera.getWorldPosition(vector);

            let distance = sprite.parent.position.distanceTo(vector) / 20;
            let maxDistance = Math.max(4, distance);
            sprite.scale.x = sprite.material.map.width * 0.006 * maxDistance;
            sprite.scale.y = sprite.material.map.height * 0.006 * maxDistance;
          }
        }
      }
    }

    return pushOrig.apply(this, args);
  }
})();