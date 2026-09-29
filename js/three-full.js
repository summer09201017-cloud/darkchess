/* three-full.js — 本站的 three 相容門面(2026-09-29,v12 真 3D)
 *
 * 為什麼有這支:three-shim.js 是 skill animal-opponent-kit 的**保護副本**(跟 skill 同一份、browser-check 逐位元比),
 *   只匯出動物引擎用得到的名字;棋盤底座 board3d.js / 棋子 pieces3d.js 還要 Plane / Fog / CanvasTexture / Sprite… ⇒
 *   不去改 shim,另開這支門面:先 import shim(讓 r128 補上 CapsuleGeometry),再從**同一個**全域 THREE 把名字全部接出來。
 *   ⇒ 整頁只有一個 THREE 實例(vendor/three.r128.min.js),動物跟棋盤在同一個 scene 裡不會因為兩份 three 而對不上型別。
 * ★ r128 與新版的差異(board3d.js 那邊有對應處理):色彩空間是 texture.encoding / renderer.outputEncoding(= sRGBEncoding),
 *   不是 colorSpace / SRGBColorSpace;燈光是舊的非物理強度(PointLight 22 會整片過曝,本站自己調)。
 */
import "./three-shim.js";

const T = globalThis.THREE;
if (!T) throw new Error("three-full: 要先載入 vendor/three.r128.min.js");

export default T;
export const {
  Group, Object3D, Mesh, Scene, PerspectiveCamera, WebGLRenderer, Sprite, SpriteMaterial,
  SphereGeometry, CylinderGeometry, CapsuleGeometry, BoxGeometry, PlaneGeometry, CircleGeometry, RingGeometry, TorusGeometry,
  BufferGeometry, Float32BufferAttribute,
  MeshStandardMaterial, MeshBasicMaterial, MeshLambertMaterial,
  Vector2, Vector3, Color, Raycaster, Plane, Ray, Fog, Clock, CanvasTexture, Texture,
  AmbientLight, DirectionalLight, PointLight, HemisphereLight,
  MathUtils, DoubleSide, FrontSide, BackSide, sRGBEncoding, LinearEncoding,
} = T;
