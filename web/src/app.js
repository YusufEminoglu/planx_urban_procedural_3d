/* app.js - PlanX Urban Procedural 3D */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Application State
let scene, camera, renderer, controls, composer;
let raycaster, mouse;
let parcelFeatures = []; // Array of { fid, properties, outerRing, parcelMesh, buildingMesh, setbackMesh, sidewalkMesh, zoningMesh, area, params }
let selectedParcel = null;
let skyDome = null;
let skyUniforms = null;
let pedestrians = []; // Array of { mesh, path, speed, progress, direction }

// Traffic State
let trafficCars = []; // Array of { carMesh, roadRing, speed, progress }

// Time Animation State
let isTimeAnimating = false;
let timeAnimationId = null;

// Cinematic Tour State
let isCinematicTour = false;

// 3D Ruler / Measurement Tool State
let isMeasurementMode = false;
let measurementPoints = [];
let tempMeasureLine = null;
let tempMeasureLabel = null;
let savedMeasurements = [];

// Height Dragging State
let heightHandleMesh = null;
let isDraggingHeight = false;
let dragStartHeight = 0;
let dragStartFloors = 0;
let dragIntersectionPlane = null;

// Setback Dragging State
let setbackHandleMesh = null;
let isDraggingSetback = false;

// Light references
let dirLight, ambientLight;

// Projection variables (local offset)
let centerX = 0;
let centerY = 0;

// Setup UI Element references
const loadingEl = document.getElementById('loading');
const placeholderEl = document.getElementById('selection-placeholder');
const controlsEl = document.getElementById('editor-controls');
const btnSync = document.getElementById('btn-sync');
const btnCapture = document.getElementById('btn-capture');
const btnExportCsv = document.getElementById('btn-export-csv');
const btnSolveSelected = document.getElementById('btn-solve-selected');
const btnSolveCity = document.getElementById('btn-solve-city');
const btnReload = document.getElementById('btn-reload');
const btnTour = document.getElementById('btn-tour');
const btnMeasure = document.getElementById('btn-measure');
const btnClearMeasure = document.getElementById('hud-btn-clear-measure');
const crsWarningBannerEl = document.getElementById('crs-warning-banner');

// View settings checkbox controls
const toggleBuildingsEl = document.getElementById('toggle-buildings');
const toggleZoningEl = document.getElementById('toggle-zoning');
const toggleSetbacksEl = document.getElementById('toggle-setbacks');
const toggleSidewalksEl = document.getElementById('toggle-sidewalks');
const togglePedestriansEl = document.getElementById('toggle-pedestrians');
const toggleTrafficEl = document.getElementById('toggle-traffic');
const toggleGridEl = document.getElementById('toggle-grid');

// Input controls
const inTypology = document.getElementById('input-typology');
const inUsage = document.getElementById('input-usage');
const inRoofStyle = document.getElementById('input-roof-style');
const inSetback = document.getElementById('input-setback');
const inFloors = document.getElementById('input-floors');
const inFloorHeight = document.getElementById('input-floorheight');
const inMaxBcr = document.getElementById('input-max-bcr');
const inMaxFar = document.getElementById('input-max-far');
const inMaxHeight = document.getElementById('input-max-height');
const inTime = document.getElementById('input-time');
const btnPlayTime = document.getElementById('btn-play-time');

// Stepped Tower Controls
const steppedTowerControlsEl = document.getElementById('stepped-tower-controls');
const inStepbackInterval = document.getElementById('input-stepback-interval');
const inStepbackDepth = document.getElementById('input-stepback-depth');
const lblStepbackInterval = document.getElementById('val-stepback-interval');
const lblStepbackDepth = document.getElementById('val-stepback-depth');

// Label values
const lblSetback = document.getElementById('val-setback');
const lblFloors = document.getElementById('val-floors');
const lblFloorHeight = document.getElementById('val-floorheight');
const lblMaxBcr = document.getElementById('val-max-bcr');
const lblMaxFar = document.getElementById('val-max-far');
const lblMaxHeight = document.getElementById('val-max-height');
const lblTime = document.getElementById('val-time');

// Metrics
const metFid = document.getElementById('prop-fid');
const metArea = document.getElementById('prop-area');
const metFootprint = document.getElementById('metric-footprint');
const metGfa = document.getElementById('metric-gfa');
const metHeight = document.getElementById('metric-height');
const metBcrLabel = document.getElementById('metric-bcr-label');
const metFarLabel = document.getElementById('metric-far-label');
const metStatus = document.getElementById('metric-status');

// Gauge elements
const bcrFillEl = document.getElementById('gauge-bcr-fill');
const farFillEl = document.getElementById('gauge-far-fill');

// Population Estimator elements
const metUnits = document.getElementById('metric-units');
const metPopulation = document.getElementById('metric-population');
const metDensity = document.getElementById('metric-density');

// Sustainability Indicators elements
const metOsr = document.getElementById('metric-osr');
const metCarbon = document.getElementById('metric-carbon');
const metRunoff = document.getElementById('metric-runoff');

// Apply All button
const btnApplyAll = document.getElementById('btn-apply-all');

// HUD
const hudTotalParcels = document.getElementById('hud-total-parcels');
const hudCrs = document.getElementById('hud-crs');

// Grid reference for toggle
let gridHelper = null;

// Initialize the 3D scene
function init() {
    // 1. Scene setup
    scene = new THREE.Scene();

    // 2. Sky Gradient Dome — procedural shader sphere replacing flat background
    const skyGeom = new THREE.SphereGeometry(2000, 32, 32);
    const skyVertShader = `
        varying vec3 vWorldPosition;
        void main() {
            vec4 worldPos = modelMatrix * vec4(position, 1.0);
            vWorldPosition = worldPos.xyz;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `;
    const skyFragShader = `
        uniform vec3 uHorizonColor;
        uniform vec3 uZenithColor;
        uniform float uStarIntensity;
        varying vec3 vWorldPosition;

        // Simple pseudo-random for stars
        float hash(vec2 p) {
            return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }

        void main() {
            float h = normalize(vWorldPosition).y;
            float t = clamp(h, 0.0, 1.0);
            vec3 sky = mix(uHorizonColor, uZenithColor, t);

            // Star field — tiny bright dots at high elevation
            if (uStarIntensity > 0.01) {
                vec3 dir = normalize(vWorldPosition);
                vec2 starUV = dir.xz / (dir.y + 1.0) * 200.0;
                float star = hash(floor(starUV));
                float brightness = step(0.997, star) * uStarIntensity;
                sky += vec3(brightness);
            }

            gl_FragColor = vec4(sky, 1.0);
        }
    `;
    skyUniforms = {
        uHorizonColor: { value: new THREE.Color(0x0a0e27) },
        uZenithColor:  { value: new THREE.Color(0x020617) },
        uStarIntensity: { value: 0.0 }
    };
    const skyMat = new THREE.ShaderMaterial({
        vertexShader: skyVertShader,
        fragmentShader: skyFragShader,
        uniforms: skyUniforms,
        side: THREE.BackSide,
        depthWrite: false
    });
    skyDome = new THREE.Mesh(skyGeom, skyMat);
    scene.add(skyDome);

    // 3. Camera setup
    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 1, 10000);
    camera.position.set(0, 180, 280);

    // 4. Renderer setup
    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    document.getElementById('viewport').appendChild(renderer.domElement);

    // 5. Post-Processing Bloom
    composer = new EffectComposer(renderer);
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);
    const bloomPass = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        0.3,   // strength
        0.4,   // radius
        0.85   // threshold
    );
    composer.addPass(bloomPass);
    const outputPass = new OutputPass();
    composer.addPass(outputPass);

    // 6. OrbitControls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2 - 0.02;
    controls.addEventListener('start', () => {
        if (isCinematicTour) {
            isCinematicTour = false;
            if (btnTour) btnTour.classList.remove('active');
        }
    });

    // 7. Lighting
    ambientLight = new THREE.AmbientLight(0xffffff, 0.45);
    scene.add(ambientLight);

    dirLight = new THREE.DirectionalLight(0xffffff, 0.85);
    dirLight.position.set(200, 450, 150);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 1200;
    
    const d = 600;
    dirLight.shadow.camera.left = -d;
    dirLight.shadow.camera.right = d;
    dirLight.shadow.camera.top = d;
    dirLight.shadow.camera.bottom = -d;
    scene.add(dirLight);

    // 8. Ground Terrain Plane with subtle grid texture
    const groundCanvas = document.createElement('canvas');
    groundCanvas.width = 512;
    groundCanvas.height = 512;
    const gCtx = groundCanvas.getContext('2d');
    gCtx.fillStyle = '#0f1520';
    gCtx.fillRect(0, 0, 512, 512);
    // Draw subtle grid lines — each cell ≈ 10m  (512px / 24 cells ≈ 21px per cell)
    gCtx.strokeStyle = 'rgba(30, 41, 59, 0.35)';
    gCtx.lineWidth = 0.5;
    const cellSize = 512 / 24;
    for (let i = 0; i <= 24; i++) {
        const p = i * cellSize;
        gCtx.beginPath(); gCtx.moveTo(p, 0); gCtx.lineTo(p, 512); gCtx.stroke();
        gCtx.beginPath(); gCtx.moveTo(0, p); gCtx.lineTo(512, p); gCtx.stroke();
    }
    const groundTex = new THREE.CanvasTexture(groundCanvas);
    groundTex.wrapS = THREE.RepeatWrapping;
    groundTex.wrapT = THREE.RepeatWrapping;
    groundTex.repeat.set(10, 10);

    const groundGeom = new THREE.PlaneGeometry(2400, 2400);
    groundGeom.rotateX(-Math.PI / 2);
    const groundMat = new THREE.MeshStandardMaterial({
        map: groundTex,
        color: 0x111827,
        roughness: 0.95,
        metalness: 0.05
    });
    const groundMesh = new THREE.Mesh(groundGeom, groundMat);
    groundMesh.receiveShadow = true;
    groundMesh.position.y = -0.1;
    scene.add(groundMesh);

    // Subtle overlay grid (kept for fine detail but semi-transparent)
    const grid = new THREE.GridHelper(1200, 120, 0x1e293b, 0x0f172a);
    grid.position.y = -0.05;
    grid.material.opacity = 0.4;
    grid.material.transparent = true;
    scene.add(grid);
    gridHelper = grid;

    // 9. Atmospheric Fog
    scene.fog = new THREE.FogExp2(0x0a0e17, 0.0012);

    // Build Solar Orbit Arc
    const arcPoints = [];
    const radius = 500;
    const segments = 64;
    for (let i = 0; i <= segments; i++) {
        const theta = (i / segments) * Math.PI; // 0 to 180 degrees
        const x = Math.cos(theta + Math.PI) * radius;
        const y = Math.sin(theta) * radius;
        const z = 100;
        arcPoints.push(new THREE.Vector3(x, y, z));
    }
    const arcGeom = new THREE.BufferGeometry().setFromPoints(arcPoints);
    const arcMat = new THREE.LineDashedMaterial({
        color: 0xeab308,
        dashSize: 10,
        gapSize: 8,
        transparent: true,
        opacity: 0.35
    });
    const solarArc = new THREE.Line(arcGeom, arcMat);
    solarArc.computeLineDistances();
    scene.add(solarArc);
    window.solarArc = solarArc;

    // Build Sun/Moon Sphere
    const sunSphereGeom = new THREE.SphereGeometry(10, 16, 16);
    const sunSphereMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });
    const sunSphere = new THREE.Mesh(sunSphereGeom, sunSphereMat);
    scene.add(sunSphere);
    window.sunSphere = sunSphere;

    // 10. Interaction
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();
    window.addEventListener('click', onDocumentClick);
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('resize', onWindowResize);

    setupInputListeners();

    // 11. Load Data
    loadGeoJSON();

    animate();
}

// Render loop
function animate() {
    requestAnimationFrame(animate);
    
    // Auto orbit camera for Cinematic Tour
    if (isCinematicTour) {
        const offset = new THREE.Vector3().subVectors(camera.position, controls.target);
        const radius = Math.sqrt(offset.x * offset.x + offset.z * offset.z);
        let angle = Math.atan2(offset.z, offset.x);
        angle += 0.002; // slow orbit speed
        camera.position.x = controls.target.x + radius * Math.cos(angle);
        camera.position.z = controls.target.z + radius * Math.sin(angle);
    }
    
    // Update controls
    controls.update();

    // Update traffic cars positions
    updateTraffic();

    // Update pedestrian positions
    updatePedestrians();

    // Beacon light blinking animation
    const timeSec = Date.now() * 0.005;
    scene.traverse(child => {
        if (child.userData && child.userData.isBeacon) {
            child.material.opacity = 0.2 + Math.abs(Math.sin(timeSec * 2)) * 0.8;
        }
    });

    // Update 3D ruler tool labels screen positions
    updateMeasurementLabels();

    composer.render();
}

// Resize handler
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
}

// Set up UI input controls event handlers
function setupInputListeners() {
    const triggerUpdate = () => {
        if (!selectedParcel) return;
        
        selectedParcel.modified = true;

        // Read slider values
        selectedParcel.params.setback = parseFloat(inSetback.value);
        selectedParcel.params.floors = parseInt(inFloors.value);
        selectedParcel.params.floorHeight = parseFloat(inFloorHeight.value);
        selectedParcel.params.typology = inTypology.value;
        selectedParcel.params.usage = inUsage.value;
        selectedParcel.params.roofStyle = inRoofStyle.value;
        
        selectedParcel.params.stepbackInterval = parseInt(inStepbackInterval.value);
        selectedParcel.params.stepbackDepth = parseFloat(inStepbackDepth.value);

        // Zoning limits
        selectedParcel.params.maxBcr = parseFloat(inMaxBcr.value);
        selectedParcel.params.maxFar = parseFloat(inMaxFar.value);
        selectedParcel.params.maxHeight = parseFloat(inMaxHeight.value);

        // Update labels
        lblSetback.textContent = selectedParcel.params.setback.toFixed(1);
        lblFloors.textContent = selectedParcel.params.floors;
        lblFloorHeight.textContent = selectedParcel.params.floorHeight.toFixed(1);
        lblMaxBcr.textContent = selectedParcel.params.maxBcr.toFixed(2);
        lblMaxFar.textContent = selectedParcel.params.maxFar.toFixed(1);
        lblMaxHeight.textContent = selectedParcel.params.maxHeight.toFixed(1);
        
        lblStepbackInterval.textContent = selectedParcel.params.stepbackInterval;
        lblStepbackDepth.textContent = selectedParcel.params.stepbackDepth.toFixed(1);

        // Show/hide stepped tower controls
        if (selectedParcel.params.typology === 'SteppedTower') {
            steppedTowerControlsEl.classList.remove('hidden');
        } else {
            steppedTowerControlsEl.classList.add('hidden');
        }

        // Rebuild meshes
        rebuildParcel3D(selectedParcel);
        updateDashboard(selectedParcel);

        // Update height handle position or remove it if park
        if (selectedParcel.params.usage !== 'Park') {
            if (heightHandleMesh) {
                updateHeightHandle();
            } else {
                let cx = 0, cy = 0;
                const ring = selectedParcel.outerRing;
                ring.forEach(pt => { cx += pt.x; cy += pt.y; });
                cx /= ring.length;
                cy /= ring.length;
                const height = selectedParcel.params.floors * selectedParcel.params.floorHeight;
                spawnHeightHandle(cx, cy, height);
            }
        } else {
            removeHeightHandle();
        }
    };

    const triggerTimeUpdate = () => {
        if (isTimeAnimating) {
            toggleTimeAnimation(); // Stop playing if user manually drags slider
        }
        const tVal = parseFloat(inTime.value);
        const hours = Math.floor(tVal);
        const mins = Math.floor((tVal % 1) * 60).toString().padStart(2, '0');
        lblTime.textContent = `${hours}:${mins}`;

        updateSolarPhysics(tVal);
    };

    inSetback.addEventListener('input', triggerUpdate);
    inFloors.addEventListener('input', triggerUpdate);
    inFloorHeight.addEventListener('input', triggerUpdate);
    inTypology.addEventListener('change', triggerUpdate);
    inUsage.addEventListener('change', triggerUpdate);
    inRoofStyle.addEventListener('change', triggerUpdate);
    
    inStepbackInterval.addEventListener('input', triggerUpdate);
    inStepbackDepth.addEventListener('input', triggerUpdate);
    
    // Zoning inputs
    inMaxBcr.addEventListener('input', triggerUpdate);
    inMaxFar.addEventListener('input', triggerUpdate);
    inMaxHeight.addEventListener('input', triggerUpdate);

    // Time-of-day slider
    inTime.addEventListener('input', triggerTimeUpdate);

    // Play Solar animation button
    if (btnPlayTime) {
        btnPlayTime.addEventListener('click', toggleTimeAnimation);
    }

    btnSync.addEventListener('click', syncToQGIS);
    btnCapture.addEventListener('click', captureViewport);
    if (btnExportCsv) {
        btnExportCsv.addEventListener('click', exportPlanningReport);
    }
    if (btnSolveSelected) {
        btnSolveSelected.addEventListener('click', () => {
            if (selectedParcel) {
                optimizeParcelZoning(selectedParcel);
                rebuildParcel3D(selectedParcel);
                selectParcel(selectedParcel);
                updateDashboard(selectedParcel);
            } else {
                alert("Please select a parcel first.");
            }
        });
    }
    if (btnSolveCity) {
        btnSolveCity.addEventListener('click', solveCityLayout);
    }

    // Cinematic Tour Toggle
    if (btnTour) {
        btnTour.addEventListener('click', () => {
            isCinematicTour = !isCinematicTour;
            btnTour.classList.toggle('active', isCinematicTour);
        });
    }

    // Toggle 3D Ruler / Measurement Mode
    if (btnMeasure) {
        btnMeasure.addEventListener('click', () => {
            isMeasurementMode = !isMeasurementMode;
            btnMeasure.classList.toggle('active', isMeasurementMode);
            
            if (isMeasurementMode) {
                // De-select active parcel to prevent interference
                deselectParcel();
                // Ensure cinematic tour is off
                if (isCinematicTour) {
                    isCinematicTour = false;
                    if (btnTour) btnTour.classList.remove('active');
                }
                
                // Initialize temp lines/labels if they don't exist yet
                initTemporaryMeasurementAssets();
            } else {
                // Disable measurement mode
                document.body.style.cursor = 'default';
                if (tempMeasureLine) tempMeasureLine.visible = false;
                if (tempMeasureLabel) tempMeasureLabel.style.display = 'none';
                measurementPoints = [];
            }
        });
    }

    // Clear Measurements
    if (btnClearMeasure) {
        btnClearMeasure.addEventListener('click', clearAllMeasurements);
    }

    // Reload Data button
    if (btnReload) {
        btnReload.addEventListener('click', reloadData);
    }

    // View toggles listeners
    const onVisibilityChange = () => {
        updateLayersVisibility();
    };

    if (toggleBuildingsEl) toggleBuildingsEl.addEventListener('change', onVisibilityChange);
    if (toggleZoningEl) toggleZoningEl.addEventListener('change', onVisibilityChange);
    if (toggleSetbacksEl) toggleSetbacksEl.addEventListener('change', onVisibilityChange);
    if (toggleSidewalksEl) toggleSidewalksEl.addEventListener('change', onVisibilityChange);
    if (togglePedestriansEl) togglePedestriansEl.addEventListener('change', onVisibilityChange);
    if (toggleTrafficEl) toggleTrafficEl.addEventListener('change', onVisibilityChange);
    if (toggleGridEl) toggleGridEl.addEventListener('change', onVisibilityChange);

    // Apply All button
    if (btnApplyAll) {
        btnApplyAll.addEventListener('click', applyToAllParcels);
    }

    // Keyboard shortcuts
    window.addEventListener('keydown', handleKeyboardShortcuts);
}

// Update lights and sky theme based on solar time of day
function updateSolarPhysics(timeVal) {
    // Math model of sun orbit path
    const angle = ((timeVal - 6) / 16) * Math.PI; // map 6:00-22:00 to 0-180 degrees
    const isNight = timeVal < 7.5 || timeVal > 19.5;

    // Dome Orbit position
    const radius = 500;
    dirLight.position.x = Math.cos(angle + Math.PI) * radius;
    dirLight.position.y = Math.sin(angle) * radius;
    dirLight.position.z = 100;

    // Update Sun/Moon sphere mesh
    if (window.sunSphere) {
        window.sunSphere.position.copy(dirLight.position);
        if (isNight) {
            window.sunSphere.material.color.setHex(0xe2e8f0); // silver moon
            window.sunSphere.scale.setScalar(0.75);
        } else {
            window.sunSphere.material.color.setHex(0xfef08a); // glowing yellow sun
            window.sunSphere.scale.setScalar(1.0);
        }
    }

    // Update sky dome gradient and stars
    if (skyUniforms) {
        if (isNight) {
            skyUniforms.uHorizonColor.value.setHex(0x020208);
            skyUniforms.uZenithColor.value.setHex(0x000005);
            skyUniforms.uStarIntensity.value = 0.9;
        } else {
            skyUniforms.uHorizonColor.value.setHex(0xbae6fd); // Bright sky blue horizon
            skyUniforms.uZenithColor.value.setHex(0x0ea5e9);  // Rich sky blue zenith
            skyUniforms.uStarIntensity.value = 0.0;
        }
    }

    // Update atmospheric fog color to match sky
    if (scene.fog) {
        scene.fog.color.setHex(isNight ? 0x020208 : 0xf1f5f9); // Clean slate-100 day mist
    }

    if (isNight) {
        ambientLight.color.setHex(0x1e1b4b); // Dim indigo light
        ambientLight.intensity = 0.25;
        dirLight.intensity = 0.05; // Dim moon-like sun
    } else {
        // Daylight Mode
        ambientLight.color.setHex(0xffffff);
        ambientLight.intensity = 0.75; // Ambient light increased for high-fidelity visibility
        
        // Solar intensity peaks at noon
        const peakFactor = Math.sin(angle);
        dirLight.intensity = 0.5 + peakFactor * 0.6; // High intensity sun rays
    }

    // Update active building emission light and streetlights visibility
    parcelFeatures.forEach(item => {
        // Toggle building window glow at night
        if (item.buildingMesh) {
            item.buildingMesh.traverse(child => {
                if (child.isMesh && Array.isArray(child.material)) {
                    const wallMaterial = child.material[1];
                    if (wallMaterial && wallMaterial.emissiveMap) {
                        wallMaterial.emissiveIntensity = isNight ? 1.0 : 0.0;
                    }
                }
            });
        }

        // Toggle streetlight bulb visibility
        if (item.sidewalkMesh) {
            item.sidewalkMesh.traverse(child => {
                if (child.userData && child.userData.isStreetlightBulb) {
                    child.visible = isNight;
                }
            });
        }
    });

    // Toggle headlights on traffic cars
    trafficCars.forEach(car => {
        car.carMesh.traverse(child => {
            if (child.userData && (child.userData.isHeadlight || child.userData.isTaillight)) {
                child.visible = isNight;
            }
        });
    });
}

// Mockup GeoJSON for Offline Demo Mode
const mockupGeoJSON = {
    type: "FeatureCollection",
    crs_is_geographic: false,
    crs: {
        properties: {
            name: "EPSG:3857"
        }
    },
    features: [
        {
            type: "Feature",
            id: 1,
            properties: {
                fid: 1,
                setback: 3.0,
                floors: 6,
                floor_h: 3.2,
                typology: "SteppedTower",
                usage: "MixedUse",
                roof_style: "Flat",
                stepback_i: 3,
                stepback_d: 1.5,
                max_bcr: 0.5,
                max_far: 3.0,
                max_height: 25.0
            },
            geometry: {
                type: "Polygon",
                coordinates: [[
                    [-30, -30],
                    [30, -30],
                    [30, 30],
                    [-30, 30],
                    [-30, -30]
                ]]
            }
        },
        {
            type: "Feature",
            id: 2,
            properties: {
                fid: 2,
                setback: 2.0,
                floors: 3,
                floor_h: 3.0,
                typology: "Courtyard",
                usage: "Residential",
                roof_style: "Hipped",
                max_bcr: 0.4,
                max_far: 1.5,
                max_height: 12.0
            },
            geometry: {
                type: "Polygon",
                coordinates: [[
                    [50, -50],
                    [110, -50],
                    [110, 10],
                    [50, 10],
                    [50, -50]
                ]]
            }
        },
        {
            type: "Feature",
            id: 3,
            properties: {
                fid: 3,
                setback: 4.0,
                floors: 1,
                floor_h: 3.5,
                typology: "Tower",
                usage: "Park",
                roof_style: "Flat",
                max_bcr: 0.1,
                max_far: 0.1,
                max_height: 4.0
            },
            geometry: {
                type: "Polygon",
                coordinates: [[
                    [-110, -50],
                    [-50, -50],
                    [-50, 10],
                    [-110, 10],
                    [-110, -50]
                ]]
            }
        },
        {
            type: "Feature",
            id: 4,
            properties: {
                fid: 4,
                setback: 3.0,
                floors: 10,
                floor_h: 3.0,
                typology: "Tower",
                usage: "Commercial",
                roof_style: "Flat",
                max_bcr: 0.6,
                max_far: 5.0,
                max_height: 35.0
            },
            geometry: {
                type: "Polygon",
                coordinates: [[
                    [-30, 50],
                    [30, 50],
                    [30, 110],
                    [-30, 110],
                    [-30, 50]
                ]]
            }
        }
    ]
};

// Fetch exported layer GeoJSON from local Python server
async function loadGeoJSON() {
    try {
        const response = await fetch('/data.geojson');
        if (!response.ok) throw new Error("Could not load data");
        
        const data = await response.json();
        parseGeoJSON(data);
        
        loadingEl.style.opacity = 0;
        setTimeout(() => loadingEl.classList.add('hidden'), 500);
    } catch (e) {
        console.warn("Could not reach QGIS server, falling back to Demo Mockup layer.", e);
        
        // Load mock dataset
        parseGeoJSON(mockupGeoJSON);
        
        // Show offline warning banner after parseGeoJSON to prevent it from hiding it
        if (crsWarningBannerEl) {
            crsWarningBannerEl.className = 'warning-banner';
            crsWarningBannerEl.style.background = 'linear-gradient(135deg, #d97706, #b45309)';
            crsWarningBannerEl.classList.remove('hidden');
            const warningText = crsWarningBannerEl.querySelector('.warning-text');
            if (warningText) {
                warningText.innerHTML = '<strong>Offline Demo Mode:</strong> Loaded procedural mockup parcels. Start the plugin server in QGIS to connect live.';
            }
        }
        
        loadingEl.style.opacity = 0;
        setTimeout(() => loadingEl.classList.add('hidden'), 500);
    }
}

// Parse GeoJSON geometries and center coordinates
function parseGeoJSON(data) {
    if (!data.features || data.features.length === 0) {
        clearScene();
        hudTotalParcels.textContent = "0";
        if (placeholderEl) {
            placeholderEl.innerHTML = "<strong>No features found in the active layer.</strong><br><br>Please draw polygon features (parcels/building blocks) in QGIS first, then click <strong>Reload Data from QGIS</strong>.";
        }
        return;
    }

    // Clear existing scene elements and memory/resources
    clearScene();

    // Reset default placeholder message
    if (placeholderEl) {
        placeholderEl.innerHTML = "Please click on a parcel in the 3D scene to start designing.";
    }

    // Check if layer CRS is geographic
    const isGeographic = !!data.crs_is_geographic;
    if (crsWarningBannerEl) {
        if (isGeographic) {
            crsWarningBannerEl.classList.remove('hidden');
        } else {
            crsWarningBannerEl.classList.add('hidden');
        }
    }

    hudTotalParcels.textContent = data.features.length;
    if (data.crs && data.crs.properties && data.crs.properties.name) {
        const crsName = data.crs.properties.name.split("::").pop();
        if (hudCrs) {
            hudCrs.textContent = crsName;
        }
    }

    // 1. Calculate bounding box center
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    data.features.forEach(f => {
        if (!f.geometry || (f.geometry.type !== 'Polygon' && f.geometry.type !== 'MultiPolygon')) return;
        
        const rings = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
        rings.forEach(ring => {
            ring[0].forEach(coord => {
                if (coord[0] < minX) minX = coord[0];
                if (coord[0] > maxX) maxX = coord[0];
                if (coord[1] < minY) minY = coord[1];
                if (coord[1] > maxY) maxY = coord[1];
            });
        });
    });

    centerX = (minX + maxX) / 2;
    centerY = (minY + maxY) / 2;

    // 2. Parse features
    data.features.forEach((f, idx) => {
        if (!f.geometry) return;
        const fid = f.id !== undefined ? f.id : idx;
        const props = f.properties || {};

        let coords = [];
        if (f.geometry.type === 'Polygon') {
            coords = f.geometry.coordinates[0];
        } else if (f.geometry.type === 'MultiPolygon') {
            coords = f.geometry.coordinates[0][0];
        }

        if (!coords || coords.length < 3) return;

        // Convert coordinates to local meters
        const localPoints = coords.map(pt => {
            return { x: pt[0] - centerX, y: pt[1] - centerY };
        });

        // Calculate parcel area
        const area = calculatePolygonArea(localPoints);

        // Initial params (fall back to layer attributes if existing)
        const params = {
            setback: props.setback !== undefined ? parseFloat(props.setback) : 3.0,
            floors: props.floors !== undefined ? parseInt(props.floors) : 4,
            floorHeight: props.floor_h !== undefined ? parseFloat(props.floor_h) : (props.floor_height !== undefined ? parseFloat(props.floor_height) : 3.0),
            typology: props.typology !== undefined ? props.typology : 'Tower',
            usage: props.usage !== undefined ? props.usage : 'Residential',
            roofStyle: props.roof_style !== undefined ? props.roof_style : (props.usage === 'Residential' ? 'Hipped' : 'Flat'),
            stepbackInterval: props.stepback_i !== undefined ? parseInt(props.stepback_i) : 4,
            stepbackDepth: props.stepback_d !== undefined ? parseFloat(props.stepback_d) : 1.5,
            // Zoning constraints
            maxBcr: props.max_bcr !== undefined ? parseFloat(props.max_bcr) : 0.45,
            maxFar: props.max_far !== undefined ? parseFloat(props.max_far) : 2.5,
            maxHeight: props.max_height !== undefined ? parseFloat(props.max_height) : 18.0
        };

        const item = {
            fid,
            properties: props,
            outerRing: localPoints,
            area,
            params,
            modified: false,
            parcelMesh: null,
            buildingMesh: null,
            setbackMesh: null,
            sidewalkMesh: null,
            zoningMesh: null
        };

        buildParcelGround(item);
        buildSidewalk(item);
        rebuildParcel3D(item);
        
        parcelFeatures.push(item);
    });

    // Generate Animated Traffic on road tracks
    generateTrafficCars();

    // Zoom camera to fit parcels bounds
    const maxDim = Math.max(maxX - minX, maxY - minY);
    camera.position.set(0, maxDim * 0.8, maxDim * 1.2);
    controls.target.set(0, 0, 0);
    controls.update();
}

// Dynamic color updates for parcel grounds representing zoning compliance
function updateParcelGroundColor(item, hasViolation) {
    if (!item.parcelMesh || !item.parcelMesh.material) return;
    
    let colorHex = 0x1e293b; // default unselected compliant slate grey
    
    if (item.params.usage === 'Park') {
        colorHex = 0x064e3b; // soft forest green for public parks
    } else if (selectedParcel === item) {
        colorHex = hasViolation ? 0xb91c1c : 0x0d9488; // active selection: bright red vs bright teal
    } else {
        colorHex = hasViolation ? 0x450a0a : 0x1e293b; // inactive: dark burgundy vs default slate
    }
    
    item.parcelMesh.material.color.setHex(colorHex);
}

// Render parcel boundary lines and ground surface
function buildParcelGround(item) {
    const shape = new THREE.Shape();
    item.outerRing.forEach((pt, i) => {
        if (i === 0) shape.moveTo(pt.x, pt.y);
        else shape.lineTo(pt.x, pt.y);
    });

    const geom = new THREE.ShapeGeometry(shape);
    geom.rotateX(-Math.PI / 2);

    const mat = new THREE.MeshStandardMaterial({
        color: 0x1e293b,
        roughness: 0.9,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1
    });

    const mesh = new THREE.Mesh(geom, mat);
    mesh.receiveShadow = true;
    mesh.userData = { parcelItem: item };
    scene.add(mesh);
    item.parcelMesh = mesh;

    // Draw boundary line
    const borderPoints = item.outerRing.map(pt => new THREE.Vector3(pt.x, 0.05, -pt.y));
    borderPoints.push(borderPoints[0].clone());
    
    const lineGeom = new THREE.BufferGeometry().setFromPoints(borderPoints);
    const lineMat = new THREE.LineBasicMaterial({ color: 0x475569, linewidth: 2 });
    const line = new THREE.Line(lineGeom, lineMat);
    scene.add(line);
}

// Build concrete sidewalk and place procedural streetlights along curbs
function buildSidewalk(item) {
    if (item.sidewalkMesh) {
        scene.remove(item.sidewalkMesh);
        item.sidewalkMesh.geometry.dispose();
    }

    // Outer sidewalk polygon (shifted 2.0 meters outward)
    const outerSidewalk = offsetPolygonRing(item.outerRing, -2.0);
    if (!outerSidewalk) return;

    const shape = new THREE.Shape();
    outerSidewalk.forEach((pt, i) => {
        if (i === 0) shape.moveTo(pt.x, pt.y);
        else shape.lineTo(pt.x, pt.y);
    });

    // Subtract parcel shape to make a frame
    const hole = new THREE.Path();
    item.outerRing.forEach((pt, i) => {
        if (i === 0) hole.moveTo(pt.x, pt.y);
        else hole.lineTo(pt.x, pt.y);
    });
    shape.holes.push(hole);

    // Extrude sidewalk by 0.15m height
    const geom = new THREE.ExtrudeGeometry(shape, { depth: 0.15, bevelEnabled: false });
    geom.rotateX(-Math.PI / 2);

    const mat = new THREE.MeshStandardMaterial({
        color: 0x52525b, // concrete grey
        roughness: 0.8
    });

    const mesh = new THREE.Mesh(geom, mat);
    mesh.receiveShadow = true;
    mesh.position.y = -0.05;
    scene.add(mesh);
    item.sidewalkMesh = mesh;

    // Place Procedural Streetlights along curb corners
    const numLights = Math.max(2, Math.floor(item.outerRing.length / 2));
    const step = Math.floor(item.outerRing.length / numLights);

    for (let i = 0; i < numLights; i++) {
        const idx = (i * step) % item.outerRing.length;
        const pt = item.outerRing[idx];
        
        // Offset light/tree slightly outwards onto sidewalk
        const ptNext = item.outerRing[(idx + 1) % item.outerRing.length];
        const dx = ptNext.x - pt.x;
        const dy = ptNext.y - pt.y;
        const len = Math.sqrt(dx*dx + dy*dy);
        if (len < 0.01) continue;
        const nx = -dy / len;
        const ny = dx / len;

        const lx = pt.x + nx * 1.0;
        const lz = - (pt.y + ny * 1.0);

        if (i % 2 === 0) {
            // Build streetlight pole
            const poleGeom = new THREE.CylinderGeometry(0.1, 0.15, 6, 8);
            const poleMat = new THREE.MeshStandardMaterial({ color: 0x3f3f46, metalness: 0.8 });
            const pole = new THREE.Mesh(poleGeom, poleMat);
            pole.position.set(lx, 3, lz);
            pole.castShadow = true;
            mesh.add(pole);

            // Lamp head Arm
            const armGeom = new THREE.BoxGeometry(0.2, 0.2, 1.5);
            const arm = new THREE.Mesh(armGeom, poleMat);
            arm.position.set(0, 3, 0.5);
            pole.add(arm);

            // Glowing light bulb (only visible at night)
            const bulbGeom = new THREE.SphereGeometry(0.3, 16, 16);
            const bulbMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });
            const bulb = new THREE.Mesh(bulbGeom, bulbMat);
            bulb.position.set(0, 2.8, 1.2);
            bulb.userData = { isStreetlightBulb: true };
            bulb.visible = false; // off by default (daylight)
            pole.add(bulb);

            // Spot light source casting downward
            const spotLight = new THREE.SpotLight(0xfef08a, 4, 15, Math.PI / 4, 0.5, 1);
            spotLight.position.set(0, 2.7, 1.2);
            spotLight.target.position.set(0, 0, 1.2);
            bulb.add(spotLight);
            bulb.add(spotLight.target);
        } else {
            // Plant a beautiful sidewalk tree with random style variety
            const treeStyles = ['conifer', 'deciduous', 'palm'];
            const style = treeStyles[Math.floor(Math.random() * treeStyles.length)];
            const tree = buildLowPolyTree(lx, 0.15, lz, 4 + Math.random() * 2, style);
            mesh.add(tree);
        }
    }

    // Spawn animated pedestrians on the sidewalk
    spawnSidewalkPedestrians(item, outerSidewalk);
}

// Rebuild building massing, zoning envelopes, and setback lines based on params
function rebuildParcel3D(item) {
    // 1. Clear old models
    if (item.buildingMesh) {
        scene.remove(item.buildingMesh);
        item.buildingMesh.traverse(child => {
            if (child.isMesh) {
                child.geometry.dispose();
                if (Array.isArray(child.material)) {
                    child.material.forEach(m => m.dispose());
                } else if (child.material) {
                    child.material.dispose();
                }
            }
        });
        item.buildingMesh = null;
    }
    if (item.setbackMesh) {
        scene.remove(item.setbackMesh);
        item.setbackMesh.geometry.dispose();
        item.setbackMesh = null;
    }
    if (item.zoningMesh) {
        scene.remove(item.zoningMesh);
        item.zoningMesh.geometry.dispose();
        item.zoningMesh = null;
    }

    const setback = item.params.setback;
    const floors = item.params.floors;
    const floorH = item.params.floorHeight;
    const height = floors * floorH;
    const typology = item.params.typology;
    const usage = item.params.usage;

    // 2. Generate Inset Setback Shape
    const insetRing = offsetPolygonRing(item.outerRing, setback);
    if (!insetRing || insetRing.length < 3) {
        drawSetbackErrorLine(item);
        return;
    }

    // Draw setback guideline
    const setbackPoints = insetRing.map(pt => new THREE.Vector3(pt.x, 0.1, -pt.y));
    setbackPoints.push(setbackPoints[0].clone());
    const sbGeom = new THREE.BufferGeometry().setFromPoints(setbackPoints);
    const sbMat = new THREE.LineDashedMaterial({ color: 0x14b8a6, dashSize: 2, gapSize: 1.5 });
    const sbLine = new THREE.Line(sbGeom, sbMat);
    sbLine.computeLineDistances();
    scene.add(sbLine);
    item.setbackMesh = sbLine;

    const buildingGroup = new THREE.Group();
    buildingGroup.userData = { parcelItem: item };

    // Calculate footprint area and construct shape/geometry
    let footprintArea = 0;
    let gfa = 0;
    let bldGeom = null;
    let bldMesh = null;
    let footprintPoints = [];

    // Check if usage is Park
    if (usage === 'Park') {
        const parkGroup = new THREE.Group();
        parkGroup.userData = { parcelItem: item };
        scene.add(parkGroup);
        item.buildingMesh = parkGroup;

        // Draw green turf shape
        const turfShape = new THREE.Shape();
        insetRing.forEach((pt, i) => {
            if (i === 0) turfShape.moveTo(pt.x, pt.y);
            else turfShape.lineTo(pt.x, pt.y);
        });
        const turfGeom = new THREE.ExtrudeGeometry(turfShape, { depth: 0.1, bevelEnabled: false });
        turfGeom.rotateX(-Math.PI / 2);
        const turfMat = new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.9 });
        const turfMesh = new THREE.Mesh(turfGeom, turfMat);
        turfMesh.receiveShadow = true;
        turfMesh.position.y = 0.02;
        parkGroup.add(turfMesh);

        // Add walking path: a gravel circle or oval in the center
        let cx = 0, cy = 0;
        insetRing.forEach(pt => { cx += pt.x; cy += pt.y; });
        cx /= insetRing.length;
        cy /= insetRing.length;

        const pathGeom = new THREE.TorusGeometry(8, 1.5, 8, 24);
        pathGeom.rotateX(Math.PI / 2);
        const pathMat = new THREE.MeshStandardMaterial({ color: 0xd4d4d8, roughness: 0.8 });
        const pathMesh = new THREE.Mesh(pathGeom, pathMat);
        pathMesh.position.set(cx, 0.13, -cy);
        pathMesh.receiveShadow = true;
        parkGroup.add(pathMesh);

        // Add 2 wooden benches around path
        const benchGeom = new THREE.BoxGeometry(2.5, 0.4, 0.6);
        const benchMat = new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.7 });
        const legGeom = new THREE.BoxGeometry(0.2, 0.4, 0.6);
        const legMat = new THREE.MeshStandardMaterial({ color: 0x18181b, metalness: 0.8 });

        const benchOffsets = [
            { x: cx - 6, z: -cy - 6, rot: Math.PI / 4 },
            { x: cx + 6, z: -cy + 6, rot: 5 * Math.PI / 4 }
        ];

        benchOffsets.forEach(offset => {
            const bench = new THREE.Group();
            bench.position.set(offset.x, 0.2, offset.z);
            bench.rotation.y = offset.rot;
            
            const seat = new THREE.Mesh(benchGeom, benchMat);
            seat.position.y = 0.2;
            seat.castShadow = true;
            bench.add(seat);

            const leg1 = new THREE.Mesh(legGeom, legMat);
            leg1.position.set(-1.0, 0, 0);
            leg1.castShadow = true;
            bench.add(leg1);

            const leg2 = new THREE.Mesh(legGeom, legMat);
            leg2.position.set(1.0, 0, 0);
            leg2.castShadow = true;
            bench.add(leg2);

            parkGroup.add(bench);
        });

        // Add clustered park trees
        const numParkTrees = Math.min(6, Math.max(3, Math.floor(item.area / 200)));
        for (let i = 0; i < numParkTrees; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = 3 + Math.random() * 8;
            const tx = cx + Math.cos(angle) * dist;
            const tz = -cy + Math.sin(angle) * dist;
            
            const parkStyles = ['conifer', 'deciduous', 'deciduous', 'palm'];
            const style = parkStyles[Math.floor(Math.random() * parkStyles.length)];
            const tree = buildLowPolyTree(tx, 0.1, tz, 4 + Math.random() * 3, style);
            parkGroup.add(tree);
        }

        buildZoningEnvelope(item, insetRing, item.params.maxHeight, false);
        return;
    }

    // Otherwise, generate building based on Typology
    if (typology === 'Courtyard') {
        const innerSetback = 8;
        const innerRing = offsetPolygonRing(insetRing, innerSetback);
        const outerArea = calculatePolygonArea(insetRing);
        const innerArea = innerRing ? calculatePolygonArea(innerRing) : 0;
        footprintArea = Math.max(0, outerArea - innerArea);
        gfa = footprintArea * floors;

        const bldShape = new THREE.Shape();
        insetRing.forEach((pt, i) => {
            if (i === 0) bldShape.moveTo(pt.x, pt.y);
            else bldShape.lineTo(pt.x, pt.y);
        });
        if (innerRing && innerRing.length >= 3) {
            const hole = new THREE.Path();
            innerRing.forEach((pt, i) => {
                if (i === 0) hole.moveTo(pt.x, pt.y);
                else hole.lineTo(pt.x, pt.y);
            });
            bldShape.holes.push(hole);
        }
        bldGeom = new THREE.ExtrudeGeometry(bldShape, { depth: height, bevelEnabled: false });
        bldGeom.rotateX(-Math.PI / 2);
        bldGeom.translate(0, height, 0);

        footprintPoints = insetRing; // approximate pitched roof edge
    } else if (typology === 'Slab') {
        const slabShape = buildSlabShape(insetRing, 12);
        footprintArea = calculateShapeArea(slabShape);
        gfa = footprintArea * floors;

        bldGeom = new THREE.ExtrudeGeometry(slabShape, { depth: height, bevelEnabled: false });
        bldGeom.rotateX(-Math.PI / 2);
        bldGeom.translate(0, height, 0);

        footprintPoints = slabShape.getPoints().map(pt => { return { x: pt.x, y: pt.y }; });
    } else if (typology === 'LShape') {
        const lShape = buildLShape(insetRing, 12);
        footprintArea = calculateShapeArea(lShape);
        gfa = footprintArea * floors;

        bldGeom = new THREE.ExtrudeGeometry(lShape, { depth: height, bevelEnabled: false });
        bldGeom.rotateX(-Math.PI / 2);
        bldGeom.translate(0, height, 0);

        footprintPoints = lShape.getPoints().map(pt => { return { x: pt.x, y: pt.y }; });
    } else if (typology === 'UShape') {
        const uShape = buildUShape(insetRing, 12);
        footprintArea = calculateShapeArea(uShape);
        gfa = footprintArea * floors;

        bldGeom = new THREE.ExtrudeGeometry(uShape, { depth: height, bevelEnabled: false });
        bldGeom.rotateX(-Math.PI / 2);
        bldGeom.translate(0, height, 0);

        footprintPoints = uShape.getPoints().map(pt => { return { x: pt.x, y: pt.y }; });
    } else if (typology === 'PodiumTower') {
        const podiumH = Math.min(height, 2 * floorH);
        const towerH = Math.max(0, height - podiumH);

        const podiumArea = calculatePolygonArea(insetRing);
        const towerRing = offsetPolygonRing(insetRing, 3.5) || insetRing;
        const towerArea = calculatePolygonArea(towerRing);

        const podiumFloors = Math.round(podiumH / floorH);
        const towerFloors = Math.round(towerH / floorH);

        footprintArea = podiumArea;
        gfa = (podiumArea * podiumFloors) + (towerArea * towerFloors);

        // Build Podium Mesh
        const podiumShape = new THREE.Shape();
        insetRing.forEach((pt, i) => {
            if (i === 0) podiumShape.moveTo(pt.x, pt.y);
            else podiumShape.lineTo(pt.x, pt.y);
        });
        const podiumGeom = new THREE.ExtrudeGeometry(podiumShape, { depth: podiumH, bevelEnabled: false });
        podiumGeom.rotateX(-Math.PI / 2);
        podiumGeom.translate(0, podiumH, 0);

        const matsPodium = getBuildingMaterials(usage, podiumFloors);
        const podiumMesh = new THREE.Mesh(podiumGeom, matsPodium);
        podiumMesh.castShadow = true;
        podiumMesh.receiveShadow = true;

        // Build Tower Mesh
        let towerMesh = null;
        if (towerH > 0) {
            const towerShape = new THREE.Shape();
            towerRing.forEach((pt, i) => {
                if (i === 0) towerShape.moveTo(pt.x, pt.y);
                else towerShape.lineTo(pt.x, pt.y);
            });
            const towerGeom = new THREE.ExtrudeGeometry(towerShape, { depth: towerH, bevelEnabled: false });
            towerGeom.rotateX(-Math.PI / 2);
            towerGeom.translate(0, height, 0);

            const matsTower = getBuildingMaterials(usage, towerFloors);
            towerMesh = new THREE.Mesh(towerGeom, matsTower);
            towerMesh.castShadow = true;
            towerMesh.receiveShadow = true;
        }

        const group = new THREE.Group();
        group.userData = { parcelItem: item };
        group.add(podiumMesh);
        if (towerMesh) group.add(towerMesh);
        buildingGroup.add(group);

        // Add roof details on top based on roof style selection
        const topMesh = towerMesh || podiumMesh;
        const roofStyle = item.params.roofStyle || 'Flat';
        if (roofStyle === 'Hipped') {
            buildHippedRoof(topMesh, towerRing, height);
        } else if (roofStyle === 'Gable') {
            buildGableRoof(topMesh, towerRing, height);
        } else if (roofStyle === 'Mansard') {
            buildMansardRoof(topMesh, towerRing, height);
        } else {
            addRooftopDetails(topMesh, towerRing, height, usage);
        }

        footprintPoints = towerRing; // for compliance envelope
    } else if (typology === 'SteppedTower') {
        const group = new THREE.Group();
        group.userData = { parcelItem: item };

        const stepInterval = item.params.stepbackInterval || 4;
        const stepDepth = item.params.stepbackDepth || 1.5;

        let baseHeight = 0;
        let remainingFloors = floors;
        let segmentIndex = 0;
        let lastRing = insetRing;
        let lastHeight = 0;
        let topMesh = null;

        footprintArea = calculatePolygonArea(insetRing);
        gfa = 0;

        while (remainingFloors > 0) {
            const currentSetback = setback + segmentIndex * stepDepth;
            const segmentRing = offsetPolygonRing(item.outerRing, currentSetback);
            
            if (!segmentRing || segmentRing.length < 3) {
                break;
            }

            lastRing = segmentRing;

            const segFloors = Math.min(stepInterval, remainingFloors);
            const segHeight = segFloors * floorH;
            const segArea = calculatePolygonArea(segmentRing);
            gfa += segArea * segFloors;

            const segShape = new THREE.Shape();
            segmentRing.forEach((pt, i) => {
                if (i === 0) segShape.moveTo(pt.x, pt.y);
                else segShape.lineTo(pt.x, pt.y);
            });

            const segGeom = new THREE.ExtrudeGeometry(segShape, { depth: segHeight, bevelEnabled: false });
            segGeom.rotateX(-Math.PI / 2);
            segGeom.translate(0, baseHeight + segHeight, 0);

            const mats = getBuildingMaterials(usage, segFloors);
            const segMesh = new THREE.Mesh(segGeom, mats);
            segMesh.castShadow = true;
            segMesh.receiveShadow = true;

            group.add(segMesh);
            topMesh = segMesh;

            baseHeight += segHeight;
            lastHeight = baseHeight;
            remainingFloors -= segFloors;
            segmentIndex++;
        }

        buildingGroup.add(group);

        // Add roof details on top based on roof style selection
        if (topMesh && lastRing) {
            const roofStyle = item.params.roofStyle || 'Flat';
            if (roofStyle === 'Hipped') {
                buildHippedRoof(topMesh, lastRing, lastHeight);
            } else if (roofStyle === 'Gable') {
                buildGableRoof(topMesh, lastRing, lastHeight);
            } else if (roofStyle === 'Mansard') {
                buildMansardRoof(topMesh, lastRing, lastHeight);
            } else {
                addRooftopDetails(topMesh, lastRing, lastHeight, usage);
            }
        }

        footprintPoints = lastRing; // for compliance envelope
    } else if (typology === 'MultiBuildingBlock') {
        const group = new THREE.Group();
        group.userData = { parcelItem: item };

        const ob = getOrientedBounds(insetRing);
        const W = ob.W;

        const localRing = insetRing.map(pt => {
            const rx = pt.x - ob.cx;
            const ry = pt.y - ob.cy;
            return {
                x: rx * ob.ux + ry * ob.uy,
                y: rx * ob.nx + ry * ob.ny
            };
        });

        const floorsA = Math.round(floors * 1.3);
        const floorsB = Math.round(floors * 0.7);
        const heightA = floorsA * floorH;
        const heightB = floorsB * floorH;

        footprintArea = 0;
        gfa = 0;

        let insetPoly1 = null;
        let insetPoly3 = null;

        if (W >= 40) {
            const localPoly1 = clipConvexPolygonVertical(localRing, ob.minX, ob.minX + W * 0.38);
            const localPoly2 = clipConvexPolygonVertical(localRing, ob.minX + W * 0.38, ob.minX + W * 0.62);
            const localPoly3 = clipConvexPolygonVertical(localRing, ob.minX + W * 0.62, ob.maxX);

            if (localPoly1 && localPoly1.length >= 3) {
                const globalPoly1 = localPoly1.map(pt => ({
                    x: ob.cx + pt.x * ob.ux + pt.y * ob.nx,
                    y: ob.cy + pt.x * ob.uy + pt.y * ob.ny
                }));
                insetPoly1 = offsetPolygonRing(globalPoly1, 1.2);
                if (insetPoly1 && insetPoly1.length >= 3) {
                    const a1 = calculatePolygonArea(insetPoly1);
                    footprintArea += a1;
                    gfa += a1 * floorsA;

                    const shapeA = new THREE.Shape();
                    insetPoly1.forEach((pt, i) => {
                        if (i === 0) shapeA.moveTo(pt.x, pt.y);
                        else shapeA.lineTo(pt.x, pt.y);
                    });
                    const geomA = new THREE.ExtrudeGeometry(shapeA, { depth: heightA, bevelEnabled: false });
                    geomA.rotateX(-Math.PI / 2);
                    geomA.translate(0, heightA, 0);

                    const matsA = getBuildingMaterials(usage, floorsA);
                    const meshA = new THREE.Mesh(geomA, matsA);
                    meshA.castShadow = true;
                    meshA.receiveShadow = true;
                    meshA.userData = { parcelItem: item };
                    group.add(meshA);

                    addRooftopDetails(meshA, insetPoly1, heightA, usage);
                    addBuildingBalconies(group, insetPoly1, floorsA, floorH);
                }
            }

            if (localPoly2 && localPoly2.length >= 3) {
                const globalPoly2 = localPoly2.map(pt => ({
                    x: ob.cx + pt.x * ob.ux + pt.y * ob.nx,
                    y: ob.cy + pt.x * ob.uy + pt.y * ob.ny
                }));

                const shapeP = new THREE.Shape();
                globalPoly2.forEach((pt, i) => {
                    if (i === 0) shapeP.moveTo(pt.x, pt.y);
                    else shapeP.lineTo(pt.x, pt.y);
                });
                const geomP = new THREE.ExtrudeGeometry(shapeP, { depth: 0.05, bevelEnabled: false });
                geomP.rotateX(-Math.PI / 2);
                geomP.translate(0, 0.03, 0);

                const matP = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.8 });
                const meshP = new THREE.Mesh(geomP, matP);
                meshP.receiveShadow = true;
                group.add(meshP);

                let px = 0, py = 0;
                globalPoly2.forEach(pt => { px += pt.x; py += pt.y; });
                px /= globalPoly2.length;
                py /= globalPoly2.length;

                const fountainGroup = new THREE.Group();
                fountainGroup.position.set(px, 0.06, -py);

                const rimGeom = new THREE.TorusGeometry(3.5, 0.4, 8, 16);
                rimGeom.rotateX(Math.PI / 2);
                const rimMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.5 });
                const rimMesh = new THREE.Mesh(rimGeom, rimMat);
                rimMesh.castShadow = true;
                rimMesh.receiveShadow = true;
                fountainGroup.add(rimMesh);

                const waterGeom = new THREE.CylinderGeometry(3.3, 3.3, 0.1, 16);
                const waterMat = new THREE.MeshStandardMaterial({
                    color: 0x38bdf8,
                    metalness: 0.9,
                    roughness: 0.1,
                    transparent: true,
                    opacity: 0.8
                });
                const waterMesh = new THREE.Mesh(waterGeom, waterMat);
                waterMesh.position.y = 0.1;
                fountainGroup.add(waterMesh);

                const jetGeom = new THREE.CylinderGeometry(0.05, 0.15, 1.8, 8);
                const jetMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 });
                const jet = new THREE.Mesh(jetGeom, jetMat);
                jet.position.y = 0.9;
                fountainGroup.add(jet);

                group.add(fountainGroup);

                const benchGeom = new THREE.BoxGeometry(1.6, 0.3, 0.4);
                const benchMat = new THREE.MeshStandardMaterial({ color: 0x7c2d12, roughness: 0.6 });
                const legGeom = new THREE.BoxGeometry(0.15, 0.3, 0.4);
                const legMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.8 });

                const benchOffsets = [
                    { dx: -4.8, dz: 0, rot: Math.PI / 2 },
                    { dx: 4.8, dz: 0, rot: -Math.PI / 2 },
                    { dx: 0, dz: 4.8, rot: 0 }
                ];
                benchOffsets.forEach(offset => {
                    const bench = new THREE.Group();
                    bench.position.set(px + offset.dx, 0.05, -py + offset.dz);
                    bench.rotation.y = offset.rot;
                    
                    const seat = new THREE.Mesh(benchGeom, benchMat);
                    seat.position.y = 0.15;
                    seat.castShadow = true;
                    bench.add(seat);

                    const l1 = new THREE.Mesh(legGeom, legMat);
                    l1.position.set(-0.7, 0, 0);
                    bench.add(l1);

                    const l2 = new THREE.Mesh(legGeom, legMat);
                    l2.position.set(0.7, 0, 0);
                    bench.add(l2);

                    group.add(bench);
                });

                const treePositions = [
                    { dx: -3, dz: -7 },
                    { dx: 3, dz: -7 },
                    { dx: -7, dz: 3 },
                    { dx: 7, dz: 3 }
                ];
                treePositions.forEach(tPos => {
                    const t = buildLowPolyTree(px + tPos.dx, 0.06, -py + tPos.dz, 4.5 + Math.random() * 1.5, 'deciduous');
                    group.add(t);
                });

                const pL = new THREE.Group();
                pL.position.set(px + 4, 0.06, -py - 6);
                pL.rotation.y = Math.PI / 6;

                const stripeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
                const stripeGeom = new THREE.BoxGeometry(0.1, 0.01, 3.5);
                for (let k = -1.5; k <= 1.5; k += 1.5) {
                    const stripe = new THREE.Mesh(stripeGeom, stripeMat);
                    stripe.position.set(k * 2.2, 0.01, 0);
                    pL.add(stripe);
                }

                const colors = [0xd97706, 0x2563eb, 0xdc2626];
                for (let cIdx = 0; cIdx < 2; cIdx++) {
                    const carMesh = buildDetailedCar(colors[cIdx % colors.length], 1.0);
                    carMesh.position.set((-0.75 + cIdx * 1.5) * 2.2, 0.35, 0);
                    carMesh.rotation.y = Math.PI / 2;
                    pL.add(carMesh);
                }
                group.add(pL);
            }

            if (localPoly3 && localPoly3.length >= 3) {
                const globalPoly3 = localPoly3.map(pt => ({
                    x: ob.cx + pt.x * ob.ux + pt.y * ob.nx,
                    y: ob.cy + pt.x * ob.uy + pt.y * ob.ny
                }));
                insetPoly3 = offsetPolygonRing(globalPoly3, 1.2);
                if (insetPoly3 && insetPoly3.length >= 3) {
                    const a3 = calculatePolygonArea(insetPoly3);
                    footprintArea += a3;
                    gfa += a3 * floorsB;

                    const shapeB = new THREE.Shape();
                    insetPoly3.forEach((pt, i) => {
                        if (i === 0) shapeB.moveTo(pt.x, pt.y);
                        else shapeB.lineTo(pt.x, pt.y);
                    });
                    const geomB = new THREE.ExtrudeGeometry(shapeB, { depth: heightB, bevelEnabled: false });
                    geomB.rotateX(-Math.PI / 2);
                    geomB.translate(0, heightB, 0);

                    const matsB = getBuildingMaterials('Residential', floorsB);
                    const meshB = new THREE.Mesh(geomB, matsB);
                    meshB.castShadow = true;
                    meshB.receiveShadow = true;
                    meshB.userData = { parcelItem: item };
                    group.add(meshB);

                    buildGableRoof(meshB, insetPoly3, heightB);
                    addBuildingBalconies(group, insetPoly3, floorsB, floorH);
                }
            }

            footprintPoints = insetPoly1 || insetPoly3 || insetRing;
        } else {
            const localPoly1 = clipConvexPolygonVertical(localRing, ob.minX, ob.minX + W * 0.5);
            const localPoly2 = clipConvexPolygonVertical(localRing, ob.minX + W * 0.5, ob.maxX);

            if (localPoly1 && localPoly1.length >= 3) {
                const globalPoly1 = localPoly1.map(pt => ({
                    x: ob.cx + pt.x * ob.ux + pt.y * ob.nx,
                    y: ob.cy + pt.x * ob.uy + pt.y * ob.ny
                }));
                insetPoly1 = offsetPolygonRing(globalPoly1, 1.2);
                if (insetPoly1 && insetPoly1.length >= 3) {
                    const a1 = calculatePolygonArea(insetPoly1);
                    footprintArea += a1;
                    gfa += a1 * floors;

                    const shapeA = new THREE.Shape();
                    insetPoly1.forEach((pt, i) => {
                        if (i === 0) shapeA.moveTo(pt.x, pt.y);
                        else shapeA.lineTo(pt.x, pt.y);
                    });
                    const geomA = new THREE.ExtrudeGeometry(shapeA, { depth: height, bevelEnabled: false });
                    geomA.rotateX(-Math.PI / 2);
                    geomA.translate(0, height, 0);

                    const matsA = getBuildingMaterials(usage, floors);
                    const meshA = new THREE.Mesh(geomA, matsA);
                    meshA.castShadow = true;
                    meshA.receiveShadow = true;
                    meshA.userData = { parcelItem: item };
                    group.add(meshA);

                    const roofStyle = item.params.roofStyle || 'Flat';
                    if (roofStyle === 'Hipped') {
                        buildHippedRoof(meshA, insetPoly1, height);
                    } else if (roofStyle === 'Gable') {
                        buildGableRoof(meshA, insetPoly1, height);
                    } else if (roofStyle === 'Mansard') {
                        buildMansardRoof(meshA, insetPoly1, height);
                    } else {
                        addRooftopDetails(meshA, insetPoly1, height, usage);
                    }

                    addBuildingBalconies(group, insetPoly1, floors, floorH);
                }
            }

            if (localPoly2 && localPoly2.length >= 3) {
                const globalPoly2 = localPoly2.map(pt => ({
                    x: ob.cx + pt.x * ob.ux + pt.y * ob.nx,
                    y: ob.cy + pt.x * ob.uy + pt.y * ob.ny
                }));

                const shapeP = new THREE.Shape();
                globalPoly2.forEach((pt, i) => {
                    if (i === 0) shapeP.moveTo(pt.x, pt.y);
                    else shapeP.lineTo(pt.x, pt.y);
                });
                const geomP = new THREE.ExtrudeGeometry(shapeP, { depth: 0.05, bevelEnabled: false });
                geomP.rotateX(-Math.PI / 2);
                geomP.translate(0, 0.03, 0);

                const matP = new THREE.MeshStandardMaterial({ color: 0x166534, roughness: 0.95 });
                const meshP = new THREE.Mesh(geomP, matP);
                meshP.receiveShadow = true;
                group.add(meshP);

                let px = 0, py = 0;
                globalPoly2.forEach(pt => { px += pt.x; py += pt.y; });
                px /= globalPoly2.length;
                py /= globalPoly2.length;

                const pathGeom = new THREE.BoxGeometry(4.5, 0.02, 1.2);
                const pathMat = new THREE.MeshStandardMaterial({ color: 0xd4d4d8, roughness: 0.8 });
                const path = new THREE.Mesh(pathGeom, pathMat);
                path.position.set(px, 0.09, -py);
                group.add(path);

                const bench = new THREE.Group();
                bench.position.set(px, 0.05, -py + 1.2);
                const seat = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.3, 0.4), new THREE.MeshStandardMaterial({ color: 0x78350f }));
                seat.position.y = 0.15;
                bench.add(seat);
                group.add(bench);

                const carStripe = new THREE.Group();
                carStripe.position.set(px + 4, 0.06, -py - 4);
                carStripe.rotation.y = Math.PI / 4;
                const parkedCar = buildDetailedCar(0x0ea5e9, 1.0);
                parkedCar.position.set(0, 0.35, 0);
                carStripe.add(parkedCar);
                group.add(carStripe);

                for (let k = 0; k < 4; k++) {
                    const tree = buildLowPolyTree(px - 3 + Math.random() * 6, 0.06, -py - 3 + Math.random() * 6, 4 + Math.random() * 2);
                    group.add(tree);
                }
            }

            footprintPoints = insetPoly1 || insetRing;
        }

        buildingGroup.add(group);
    } else { // Tower
        footprintArea = calculatePolygonArea(insetRing);
        gfa = footprintArea * floors;

        const bldShape = new THREE.Shape();
        insetRing.forEach((pt, i) => {
            if (i === 0) bldShape.moveTo(pt.x, pt.y);
            else bldShape.lineTo(pt.x, pt.y);
        });
        bldGeom = new THREE.ExtrudeGeometry(bldShape, { depth: height, bevelEnabled: false });
        bldGeom.rotateX(-Math.PI / 2);
        bldGeom.translate(0, height, 0);

        footprintPoints = insetRing;
    }

    if (typology !== 'PodiumTower' && typology !== 'MultiBuildingBlock') {
        const mats = getBuildingMaterials(usage, floors);
        bldMesh = new THREE.Mesh(bldGeom, mats);
        bldMesh.castShadow = true;
        bldMesh.receiveShadow = true;
        bldMesh.userData = { parcelItem: item };
        buildingGroup.add(bldMesh);

        // Add Rooftop based on Roof Style parameter
        const roofStyle = item.params.roofStyle || 'Flat';
        if (roofStyle === 'Hipped') {
            buildHippedRoof(bldMesh, footprintPoints, height);
        } else if (roofStyle === 'Gable') {
            buildGableRoof(bldMesh, footprintPoints, height);
        } else if (roofStyle === 'Mansard') {
            buildMansardRoof(bldMesh, footprintPoints, height);
        } else {
            addRooftopDetails(bldMesh, footprintPoints, height, usage);
        }

        // Add Courtyard/Inner garden trees for specific typologies
        if (typology === 'Courtyard') {
            let cx = 0, cy = 0;
            insetRing.forEach(pt => { cx += pt.x; cy += pt.y; });
            cx /= insetRing.length;
            cy /= insetRing.length;
            
            const courtTree = buildLowPolyTree(cx, 0.05, -cy, 6);
            bldMesh.add(courtTree);
        } else if (typology === 'LShape') {
            const ob = getOrientedBounds(insetRing);
            const w = Math.min(12, ob.W * 0.5);
            const h = Math.min(12, ob.H * 0.5);
            const px = ob.maxX - (ob.W - w) / 2;
            const py = ob.maxY - (ob.H - h) / 2;
            const gx = ob.cx + px * ob.ux + py * ob.nx;
            const gy = ob.cy + px * ob.uy + py * ob.ny;
            
            const courtTree = buildLowPolyTree(gx, 0.05, -gy, 5);
            bldMesh.add(courtTree);
        } else if (typology === 'UShape') {
            const ob = getOrientedBounds(insetRing);
            const w = Math.min(12, ob.W * 0.4);
            const h = Math.min(12, ob.H * 0.4);
            const px = (ob.minX + ob.maxX) / 2;
            const py = ob.maxY - (ob.H - h) / 2;
            const gx = ob.cx + px * ob.ux + py * ob.nx;
            const gy = ob.cy + px * ob.uy + py * ob.ny;
            
            const courtTree = buildLowPolyTree(gx, 0.05, -gy, 5);
            bldMesh.add(courtTree);
        }
    }

    if (usage !== 'Park') {
        // Add balconies to standard building typologies
        if (typology !== 'PodiumTower' && typology !== 'SteppedTower' && typology !== 'MultiBuildingBlock') {
            addBuildingBalconies(buildingGroup, insetRing, floors, floorH);
        }

        const lawn = buildSetbackLawn(item, insetRing);
        if (lawn) buildingGroup.add(lawn);
        addSidewalkTreesAndAssets(buildingGroup, item, insetRing);

        scene.add(buildingGroup);
        item.buildingMesh = buildingGroup;
    }

    const bcr = item.area > 0 ? (footprintArea / item.area) : 0;
    const far = item.area > 0 ? (gfa / item.area) : 0;

    // Check violations
    const heightViolation = height > item.params.maxHeight;
    const bcrViolation = bcr > item.params.maxBcr;
    const farViolation = far > item.params.maxFar;
    const hasViolation = heightViolation || bcrViolation || farViolation;

    // 3. Build Zoning Envelope
    buildZoningEnvelope(item, insetRing, item.params.maxHeight, hasViolation);

    // Update ground color dynamically matching compliance status
    updateParcelGroundColor(item, hasViolation);
}

// ───────────────────────── Low Poly Procedural Vegetation ─────────────────────────
function buildLowPolyTree(x, y, z, height, style) {
    style = style || 'conifer';
    const treeGroup = new THREE.Group();
    treeGroup.position.set(x, y, z);

    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.9 });

    if (style === 'deciduous') {
        // Deciduous: thicker trunk + noisy sphere canopy
        const trunkH = height * 0.4;
        const trunkR = trunkH * 0.1;
        const trunkGeom = new THREE.CylinderGeometry(trunkR * 0.8, trunkR, trunkH, 8);
        const trunk = new THREE.Mesh(trunkGeom, trunkMat);
        trunk.position.y = trunkH / 2;
        trunk.castShadow = true;
        treeGroup.add(trunk);

        // Sphere canopy with vertex noise displacement for organic look
        const canopyRadius = height * 0.38;
        const canopyGeom = new THREE.IcosahedronGeometry(canopyRadius, 2);
        const posAttr = canopyGeom.getAttribute('position');
        for (let i = 0; i < posAttr.count; i++) {
            const nx = posAttr.getX(i);
            const ny = posAttr.getY(i);
            const nz = posAttr.getZ(i);
            const noise = 1.0 + (Math.random() - 0.5) * 0.3;
            posAttr.setXYZ(i, nx * noise, ny * noise, nz * noise);
        }
        canopyGeom.computeVertexNormals();

        // Varied green hues for deciduous
        const greens = [0x16a34a, 0x15803d, 0x22c55e, 0x166534];
        const greenColor = greens[Math.floor(Math.random() * greens.length)];
        const foliageMat = new THREE.MeshStandardMaterial({ color: greenColor, roughness: 0.85, flatShading: true });
        const canopy = new THREE.Mesh(canopyGeom, foliageMat);
        canopy.position.y = trunkH + canopyRadius * 0.7;
        canopy.castShadow = true;
        treeGroup.add(canopy);

    } else if (style === 'palm') {
        // Palm: tall thin trunk + fan leaves radiating from top
        const trunkH = height * 0.7;
        const trunkR = height * 0.035;
        const trunkGeom = new THREE.CylinderGeometry(trunkR * 0.6, trunkR, trunkH, 6);
        const trunk = new THREE.Mesh(trunkGeom, trunkMat);
        trunk.position.y = trunkH / 2;
        trunk.castShadow = true;
        treeGroup.add(trunk);

        // Fan leaves — elongated flattened cones radiating outward
        const leafCount = 7;
        const leafLength = height * 0.45;
        const leafMat = new THREE.MeshStandardMaterial({ color: 0x22c55e, roughness: 0.8, side: THREE.DoubleSide });
        for (let i = 0; i < leafCount; i++) {
            const leafGeom = new THREE.ConeGeometry(leafLength * 0.18, leafLength, 4);
            const leaf = new THREE.Mesh(leafGeom, leafMat);
            const angle = (i / leafCount) * Math.PI * 2;
            leaf.position.set(
                Math.cos(angle) * leafLength * 0.35,
                trunkH + leafLength * 0.1,
                Math.sin(angle) * leafLength * 0.35
            );
            leaf.rotation.z = Math.cos(angle) * 0.8;
            leaf.rotation.x = Math.sin(angle) * 0.8;
            leaf.castShadow = true;
            treeGroup.add(leaf);
        }

    } else {
        // Conifer (default): stacked cones — the classic procedural look
        const trunkHeight = height * 0.35;
        const trunkRadius = trunkHeight * 0.12;
        const trunkGeom = new THREE.CylinderGeometry(trunkRadius * 0.7, trunkRadius, trunkHeight, 8);
        const trunk = new THREE.Mesh(trunkGeom, trunkMat);
        trunk.position.y = trunkHeight / 2;
        trunk.castShadow = true;
        treeGroup.add(trunk);

        const foliageHeight = height * 0.65;
        // Vary conifer greens slightly
        const coniferGreens = [0x16a34a, 0x166534, 0x14532d];
        const greenColor = coniferGreens[Math.floor(Math.random() * coniferGreens.length)];
        const foliageMat = new THREE.MeshStandardMaterial({ color: greenColor, roughness: 0.8 });
        
        const numLayers = 3;
        for (let l = 0; l < numLayers; l++) {
            const radius = foliageHeight * 0.5 * (1 - l * 0.25);
            const coneGeom = new THREE.ConeGeometry(radius, foliageHeight * 0.5, 8);
            const cone = new THREE.Mesh(coneGeom, foliageMat);
            cone.position.y = trunkHeight + (l * foliageHeight * 0.22) + (foliageHeight * 0.25);
            cone.castShadow = true;
            treeGroup.add(cone);
        }
    }

    return treeGroup;
}

// ───────────────────────── Animated Pedestrians ─────────────────────────
function spawnSidewalkPedestrians(item, sidewalkRing) {
    if (!sidewalkRing || sidewalkRing.length < 3) return;

    // Build a 3D path from the sidewalk ring midpoints (between parcel and outer edge)
    const pathPoints = [];
    for (let i = 0; i < sidewalkRing.length; i++) {
        const outer = sidewalkRing[i];
        const inner = item.outerRing[i % item.outerRing.length];
        // Midpoint of the sidewalk width
        pathPoints.push({
            x: (outer.x + inner.x) / 2,
            z: -((outer.y + inner.y) / 2)
        });
    }

    // Spawn 2-3 pedestrians per parcel sidewalk
    const numPeds = 2 + Math.floor(Math.random() * 2);
    const clothingColors = [0x3b82f6, 0xef4444, 0xf59e0b, 0x8b5cf6, 0x06b6d4, 0xe11d48, 0x84cc16, 0xf97316];

    for (let i = 0; i < numPeds; i++) {
        const pedGroup = new THREE.Group();

        // Body: capsule approximation (cylinder + hemispheres)
        const bodyColor = clothingColors[Math.floor(Math.random() * clothingColors.length)];
        const bodyMat = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.7 });
        const bodyGeom = new THREE.CapsuleGeometry(0.2, 0.7, 4, 8);
        const body = new THREE.Mesh(bodyGeom, bodyMat);
        body.position.y = 0.75;
        body.castShadow = true;
        pedGroup.add(body);

        // Head: small sphere
        const headGeom = new THREE.SphereGeometry(0.15, 8, 8);
        const skinColors = [0xf5d6c8, 0xd4a574, 0x8d5524, 0xc68642];
        const headMat = new THREE.MeshStandardMaterial({ color: skinColors[Math.floor(Math.random() * skinColors.length)], roughness: 0.6 });
        const head = new THREE.Mesh(headGeom, headMat);
        head.position.y = 1.3;
        head.castShadow = true;
        pedGroup.add(head);

        // Legs: two thin cylinders
        const legMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.8 });
        for (let s = -1; s <= 1; s += 2) {
            const legGeom = new THREE.CylinderGeometry(0.06, 0.06, 0.4, 6);
            const leg = new THREE.Mesh(legGeom, legMat);
            leg.position.set(s * 0.1, 0.2, 0);
            leg.castShadow = true;
            pedGroup.add(leg);
        }

        scene.add(pedGroup);

        pedestrians.push({
            mesh: pedGroup,
            path: pathPoints,
            speed: 0.002 + Math.random() * 0.003,
            progress: Math.random() * pathPoints.length,
            direction: Math.random() > 0.5 ? 1 : -1
        });
    }
}

// Update pedestrian positions each frame
function updatePedestrians() {
    pedestrians.forEach(ped => {
        const ring = ped.path;
        if (!ring || ring.length < 2) return;

        ped.progress += ped.speed * ped.direction;
        if (ped.progress >= ring.length) ped.progress -= ring.length;
        if (ped.progress < 0) ped.progress += ring.length;

        const idx1 = Math.floor(ped.progress) % ring.length;
        const idx2 = (idx1 + 1) % ring.length;
        const t = ped.progress % 1.0;

        const pt1 = ring[idx1];
        const pt2 = ring[idx2];

        const x = pt1.x + (pt2.x - pt1.x) * t;
        const z = pt1.z + (pt2.z - pt1.z) * t;

        ped.mesh.position.set(x, 0.15, z);

        // Face direction of travel
        const dx = pt2.x - pt1.x;
        const dz = pt2.z - pt1.z;
        if (Math.abs(dx) > 0.001 || Math.abs(dz) > 0.001) {
            ped.mesh.rotation.y = Math.atan2(dx * ped.direction, dz * ped.direction);
        }

        // Subtle walking bob
        const bobPhase = Date.now() * 0.008 + ped.progress * 10;
        ped.mesh.position.y = 0.15 + Math.abs(Math.sin(bobPhase)) * 0.05;
    });
}

// ───────────────────────── Oriented Bounding Box Helpers ─────────────────────────
function getOrientedBounds(ring) {
    let maxLen = -1;
    let bestStart = null, bestEnd = null;
    const N = ring.length;
    for (let i = 0; i < N; i++) {
        const p1 = ring[i];
        const p2 = ring[(i + 1) % N];
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const len = Math.sqrt(dx*dx + dy*dy);
        if (len > maxLen) {
            maxLen = len;
            bestStart = p1;
            bestEnd = p2;
        }
    }

    let cx = 0, cy = 0;
    ring.forEach(pt => { cx += pt.x; cy += pt.y; });
    cx /= N;
    cy /= N;

    const dx = bestEnd.x - bestStart.x;
    const dy = bestEnd.y - bestStart.y;
    const len = Math.sqrt(dx*dx + dy*dy);
    const ux = dx / len;
    const uy = dy / len;

    const nx = -uy;
    const ny = ux;

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    ring.forEach(pt => {
        const rx = pt.x - cx;
        const ry = pt.y - cy;
        const projX = rx * ux + ry * uy;
        const projY = rx * nx + ry * ny;
        if (projX < minX) minX = projX;
        if (projX > maxX) maxX = projX;
        if (projY < minY) minY = projY;
        if (projY > maxY) maxY = projY;
    });

    return {
        cx, cy,
        ux, uy,
        nx, ny,
        minX, maxX,
        minY, maxY,
        W: maxX - minX,
        H: maxY - minY
    };
}

function buildLShape(ring, width) {
    const ob = getOrientedBounds(ring);
    
    const w = Math.min(width, ob.W * 0.5);
    const h = Math.min(width, ob.H * 0.5);

    const shape = new THREE.Shape();
    
    const ptsLocal = [
        { x: ob.minX, y: ob.minY },
        { x: ob.maxX, y: ob.minY },
        { x: ob.maxX, y: ob.minY + h },
        { x: ob.minX + w, y: ob.minY + h },
        { x: ob.minX + w, y: ob.maxY },
        { x: ob.minX, y: ob.maxY }
    ];

    ptsLocal.forEach((pt, i) => {
        const gx = ob.cx + pt.x * ob.ux + pt.y * ob.nx;
        const gy = ob.cy + pt.x * ob.uy + pt.y * ob.ny;
        if (i === 0) shape.moveTo(gx, gy);
        else shape.lineTo(gx, gy);
    });

    return shape;
}

function buildUShape(ring, width) {
    const ob = getOrientedBounds(ring);
    
    const w = Math.min(width, ob.W * 0.4);
    const h = Math.min(width, ob.H * 0.4);

    const shape = new THREE.Shape();

    const ptsLocal = [
        { x: ob.minX, y: ob.maxY },
        { x: ob.minX, y: ob.minY },
        { x: ob.maxX, y: ob.minY },
        { x: ob.maxX, y: ob.maxY },
        { x: ob.maxX - w, y: ob.maxY },
        { x: ob.maxX - w, y: ob.minY + h },
        { x: ob.minX + w, y: ob.minY + h },
        { x: ob.minX + w, y: ob.maxY }
    ];

    ptsLocal.forEach((pt, i) => {
        const gx = ob.cx + pt.x * ob.ux + pt.y * ob.nx;
        const gy = ob.cy + pt.x * ob.uy + pt.y * ob.ny;
        if (i === 0) shape.moveTo(gx, gy);
        else shape.lineTo(gx, gy);
    });

    return shape;
}

// Generate textured building materials with window grids dynamically
function getBuildingMaterials(usage, floors) {
    let colorHex = '#e2e8f0';
    if (usage === 'Residential') {
        colorHex = '#b45309'; // warm corporate amber-brown
    } else if (usage === 'Commercial') {
        colorHex = '#0f172a'; // dark steel corporate facade
    } else if (usage === 'MixedUse') {
        colorHex = '#1e3a5f'; // teal-blue mixed-use facade
    } else if (usage === 'Civic') {
        colorHex = '#334155'; // professional slate civic facade
    }

    const textures = createFacadeTextures(colorHex, usage, floors);
    textures.map.repeat.set(6, 1);
    textures.emissiveMap.repeat.set(6, 1);

    const tVal = parseFloat(inTime.value);
    const isNight = tVal < 7.5 || tVal > 19.5;

    const wallMat = new THREE.MeshStandardMaterial({
        map: textures.map,
        emissiveMap: textures.emissiveMap,
        emissive: new THREE.Color(0xffffff),
        emissiveIntensity: isNight ? 1.0 : 0.0,
        roughness: 0.4,
        metalness: 0.2,
        transparent: true,
        opacity: 0.85
    });

    const roofMat = new THREE.MeshStandardMaterial({
        color: 0x334155, // concrete grey roof
        roughness: 0.8
    });

    return [roofMat, wallMat];
}

// Canvas-drawn texture mapping for realistic windows with randomized emissive maps
function createFacadeTextures(wallColor, usage, floors) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');

    const emCanvas = document.createElement('canvas');
    emCanvas.width = 256;
    emCanvas.height = 512;
    const emCtx = emCanvas.getContext('2d');

    // Draw base wall
    ctx.fillStyle = wallColor;
    ctx.fillRect(0, 0, 256, 512);

    // Emissive base is black (no glow on walls)
    emCtx.fillStyle = '#000000';
    emCtx.fillRect(0, 0, 256, 512);

    const isCommercial = usage === 'Commercial';
    const isMixedUse = usage === 'MixedUse';
    const isCivic = usage === 'Civic';
    
    // Window design details
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1.5;

    const cols = 4;
    const sliceH = 512 / floors;

    for (let f = 0; f < floors; f++) {
        const isGroundFloor = (f === floors - 1);
        const yStart = f * sliceH;
        
        // Window dimensions
        const winW = 32;
        const winH = Math.min(sliceH * 0.7, 40);
        const gapX = (256 - cols * winW) / (cols + 1);
        const gapY = (sliceH - winH) / 2;

        for (let c = 0; c < cols; c++) {
            const x = gapX + c * (winW + gapX);
            const y = yStart + gapY;

            if (isGroundFloor) {
                // Ground floor: retail shopfronts for MixedUse/Commercial, doors for others
                if (isMixedUse || isCommercial) {
                    // Glass shopfront (large windows)
                    ctx.fillStyle = '#7dd3fc'; // light sky blue glass
                    ctx.fillRect(x, yStart + 2, winW, sliceH - 4);
                    ctx.strokeRect(x, yStart + 2, winW, sliceH - 4);
                    
                    // Lit up shop window at night
                    const isLit = Math.random() < 0.8;
                    if (isLit) {
                        ctx.fillStyle = '#bae6fd';
                        ctx.fillRect(x + 2, yStart + 4, winW - 4, sliceH - 8);
                        emCtx.fillStyle = '#bae6fd';
                        emCtx.fillRect(x + 2, yStart + 4, winW - 4, sliceH - 8);
                    }
                } else {
                    // Entrance doors in center columns
                    if (c === 1 || c === 2) {
                        ctx.fillStyle = '#3f220f'; // dark wood
                        ctx.fillRect(x, yStart + 2, winW, sliceH - 2);
                        ctx.strokeRect(x, yStart + 2, winW, sliceH - 2);
                        
                        ctx.fillStyle = '#fef08a';
                        ctx.fillRect(x + 6, yStart + 8, winW - 12, sliceH * 0.3);
                        
                        const isLit = Math.random() < 0.7;
                        if (isLit) {
                            emCtx.fillStyle = '#fef08a';
                            emCtx.fillRect(x + 6, yStart + 8, winW - 12, sliceH * 0.3);
                        }
                    } else {
                        // Ground floor side window
                        ctx.fillStyle = '#1e293b';
                        ctx.fillRect(x, y, winW, winH);
                        ctx.strokeRect(x, y, winW, winH);
                        
                        const isLit = Math.random() < 0.45;
                        if (isLit) {
                            ctx.fillStyle = '#fef08a';
                            ctx.fillRect(x + 2, y + 2, winW - 4, winH - 4);
                            emCtx.fillStyle = '#fef08a';
                            emCtx.fillRect(x + 2, y + 2, winW - 4, winH - 4);
                        }
                    }
                }
            } else {
                // Upper floors
                ctx.fillStyle = (isCommercial || isMixedUse) ? '#1e3a8a' : (isCivic ? '#115e59' : '#3f3f46');
                ctx.fillRect(x, y, winW, winH);
                ctx.strokeRect(x, y, winW, winH);

                ctx.beginPath();
                ctx.moveTo(x + winW / 2, y);
                ctx.lineTo(x + winW / 2, y + winH);
                ctx.moveTo(x, y + winH / 2);
                ctx.lineTo(x + winW, y + winH / 2);
                ctx.stroke();

                const isLit = Math.random() < 0.48;
                if (isLit) {
                    const colorChoices = [
                        { lit: '#fef08a', em: '#eab308' }, // warm gold
                        { lit: '#ffedd5', em: '#f97316' }, // amber/orange
                        { lit: '#e0f2fe', em: '#0ea5e9' }, // cool blue
                        { lit: '#ccfbf1', em: '#0d9488' }  // soft teal
                    ];
                    
                    let idx = 0;
                    const rand = Math.random();
                    if (isCommercial) {
                        idx = rand < 0.5 ? 2 : (rand < 0.8 ? 3 : (rand < 0.9 ? 1 : 0));
                    } else if (usage === 'Residential') {
                        idx = rand < 0.5 ? 0 : (rand < 0.8 ? 1 : (rand < 0.9 ? 2 : 3));
                    } else {
                        idx = Math.floor(rand * 4);
                    }
                    
                    const choice = colorChoices[idx];
                    
                    ctx.fillStyle = choice.lit;
                    ctx.fillRect(x + 2, y + 2, winW - 4, winH - 4);
                    emCtx.fillStyle = choice.em;
                    emCtx.fillRect(x + 2, y + 2, winW - 4, winH - 4);
                }
            }
        }
    }

    const diffuseTex = new THREE.CanvasTexture(canvas);
    diffuseTex.wrapS = THREE.RepeatWrapping;
    diffuseTex.wrapT = THREE.RepeatWrapping;

    const emissiveTex = new THREE.CanvasTexture(emCanvas);
    emissiveTex.wrapS = THREE.RepeatWrapping;
    emissiveTex.wrapT = THREE.RepeatWrapping;

    return { map: diffuseTex, emissiveMap: emissiveTex };
}

// Hipped pitched roof generator with clay tiles
function buildHippedRoof(parentMesh, footprintPoints, height) {
    const topVerts = footprintPoints.map(pt => new THREE.Vector3(pt.x, height, -pt.y));
    const N = topVerts.length;

    let cx = 0, cz = 0;
    topVerts.forEach(v => { cx += v.x; cz += v.z; });
    cx /= N;
    cz /= N;
    const topCentroid = new THREE.Vector3(cx, height + 3.5, cz); // Ridge elevated by 3.5m

    const vertices = [];
    for (let i = 0; i < N; i++) {
        const v1 = topVerts[i];
        const v2 = topVerts[(i + 1) % N];

        vertices.push(v1.x, v1.y, v1.z);
        vertices.push(v2.x, v2.y, v2.z);
        vertices.push(topCentroid.x, topCentroid.y, topCentroid.z);
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geom.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
        color: 0x991b1b, // red clay tiles
        roughness: 0.7,
        side: THREE.DoubleSide
    });

    const mesh = new THREE.Mesh(geom, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parentMesh.add(mesh);
}

// Gable roof generator aligned with OBB longitudinal axis
function buildGableRoof(parentMesh, footprintPoints, height) {
    const ob = getOrientedBounds(footprintPoints);
    const N = footprintPoints.length;

    const midY = (ob.minY + ob.maxY) / 2;
    const ridgeH = 3.5; // height of the ridge above building roof height

    const topVerts = footprintPoints.map(pt => new THREE.Vector3(pt.x, height, -pt.y));

    // For each footprint vertex, project it onto the ridge line
    const ridgeVerts = footprintPoints.map(pt => {
        const rx = pt.x - ob.cx;
        const ry = pt.y - ob.cy;
        const lx = rx * ob.ux + ry * ob.uy;
        // Project to the center line of the OBB along local Y
        const rx_proj = lx * ob.ux + midY * ob.nx;
        const ry_proj = lx * ob.uy + midY * ob.ny;
        return new THREE.Vector3(ob.cx + rx_proj, height + ridgeH, -(ob.cy + ry_proj));
    });

    const vertices = [];
    for (let i = 0; i < N; i++) {
        const v1 = topVerts[i];
        const v2 = topVerts[(i + 1) % N];
        const vr1 = ridgeVerts[i];
        const vr2 = ridgeVerts[(i + 1) % N];

        // Triangle 1
        vertices.push(v1.x, v1.y, v1.z);
        vertices.push(v2.x, v2.y, v2.z);
        vertices.push(vr2.x, vr2.y, vr2.z);

        // Triangle 2
        vertices.push(v1.x, v1.y, v1.z);
        vertices.push(vr2.x, vr2.y, vr2.z);
        vertices.push(vr1.x, vr1.y, vr1.z);
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geom.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
        color: 0x475569, // slate grey
        roughness: 0.65,
        side: THREE.DoubleSide
    });

    const mesh = new THREE.Mesh(geom, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parentMesh.add(mesh);
}

// Mansard roof generator with steep sides and a flat top cap
function buildMansardRoof(parentMesh, footprintPoints, height) {
    const slopeH = 2.0; // Height of the steep slope
    const topH = height + slopeH;
    const insetVal = 1.5; // Inset distance for the top flat cap

    // Calculate inset points using offsetPolygonRing
    const innerRing = offsetPolygonRing(footprintPoints, insetVal);
    if (!innerRing || innerRing.length < 3) {
        // Fallback to hipped if offset fails
        buildHippedRoof(parentMesh, footprintPoints, height);
        return;
    }

    const N = footprintPoints.length;
    const topVerts = footprintPoints.map(pt => new THREE.Vector3(pt.x, height, -pt.y));
    const innerVerts = innerRing.map(pt => new THREE.Vector3(pt.x, topH, -pt.y));

    // 1. Build the steep outer sloped facets
    const vertices = [];
    for (let i = 0; i < N; i++) {
        const v1 = topVerts[i];
        const v2 = topVerts[(i + 1) % N];
        const vi1 = innerVerts[i % innerRing.length];
        const vi2 = innerVerts[(i + 1) % innerRing.length];

        // Triangle 1: v1, v2, vi2
        vertices.push(v1.x, v1.y, v1.z);
        vertices.push(v2.x, v2.y, v2.z);
        vertices.push(vi2.x, vi2.y, vi2.z);

        // Triangle 2: v1, vi2, vi1
        vertices.push(v1.x, v1.y, v1.z);
        vertices.push(vi2.x, vi2.y, vi2.z);
        vertices.push(vi1.x, vi1.y, vi1.z);
    }

    const slopeGeom = new THREE.BufferGeometry();
    slopeGeom.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    slopeGeom.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
        color: 0x334155, // French slate blue/grey
        roughness: 0.7,
        side: THREE.DoubleSide
    });

    const slopeMesh = new THREE.Mesh(slopeGeom, mat);
    slopeMesh.castShadow = true;
    slopeMesh.receiveShadow = true;
    parentMesh.add(slopeMesh);

    // 2. Build the flat top cap
    const capShape = new THREE.Shape();
    innerRing.forEach((pt, i) => {
        if (i === 0) capShape.moveTo(pt.x, pt.y);
        else capShape.lineTo(pt.x, pt.y);
    });

    const capGeom = new THREE.ShapeGeometry(capShape);
    capGeom.rotateX(-Math.PI / 2);
    capGeom.translate(0, topH, 0);

    const capMat = new THREE.MeshStandardMaterial({
        color: 0x1e293b, // dark flat cap roof
        roughness: 0.8
    });

    const capMesh = new THREE.Mesh(capGeom, capMat);
    capMesh.castShadow = true;
    capMesh.receiveShadow = true;
    parentMesh.add(capMesh);
}

// Flat roof details (helipad, HVAC boxes, beacon lights)
function addRooftopDetails(parentMesh, insetRing, height, usage) {
    let cx = 0, cy = 0;
    insetRing.forEach(pt => { cx += pt.x; cy += pt.y; });
    cx /= insetRing.length;
    cy /= insetRing.length;

    // Penthouse/elevator shaft
    const pentGeom = new THREE.BoxGeometry(6, 3, 6);
    const pentMat = new THREE.MeshStandardMaterial({ color: 0x475569 });
    const penthouse = new THREE.Mesh(pentGeom, pentMat);
    penthouse.position.set(cx, height + 1.5, -cy);
    penthouse.castShadow = true;
    parentMesh.add(penthouse);

    // Beacon warning light on penthouse top (blinking red warning beacon)
    const beaconGeom = new THREE.SphereGeometry(0.3, 8, 8);
    const beaconMat = new THREE.MeshBasicMaterial({ color: 0xef4444, transparent: true });
    const beacon = new THREE.Mesh(beaconGeom, beaconMat);
    beacon.position.set(0, 1.7, 0);
    beacon.userData = { isBeacon: true };
    penthouse.add(beacon);

    // Glowing pointlight
    const beaconLight = new THREE.PointLight(0xef4444, 2, 20);
    beacon.add(beaconLight);

    // HVAC boxes
    const hvacGeom = new THREE.BoxGeometry(2, 1.2, 2);
    const hvacMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.9, roughness: 0.2 });
    for (let i = 0; i < 2; i++) {
        const hvac = new THREE.Mesh(hvacGeom, hvacMat);
        hvac.position.set(cx - 6 + i * 12, height + 0.6, -cy + 6);
        hvac.castShadow = true;
        parentMesh.add(hvac);
    }

    // Commercial Helipad painting
    if (usage === 'Commercial' || usage === 'MixedUse') {
        const padGeom = new THREE.CylinderGeometry(5, 5, 0.1, 32);
        
        // Draw Helipad letter canvas texture
        const padCanvas = document.createElement('canvas');
        padCanvas.width = 128;
        padCanvas.height = 128;
        const padCtx = padCanvas.getContext('2d');
        padCtx.fillStyle = '#4b5563'; // concrete pad
        padCtx.fillRect(0, 0, 128, 128);
        
        // Draw white circle
        padCtx.strokeStyle = '#ffffff';
        padCtx.lineWidth = 6;
        padCtx.beginPath();
        padCtx.arc(64, 64, 40, 0, Math.PI * 2);
        padCtx.stroke();
        
        // Draw H letter
        padCtx.fillStyle = '#ffffff';
        padCtx.font = 'bold 50px Arial';
        padCtx.textAlign = 'center';
        padCtx.textBaseline = 'middle';
        padCtx.fillText('H', 64, 64);
        
        const padTex = new THREE.CanvasTexture(padCanvas);
        const padMat = new THREE.MeshStandardMaterial({ map: padTex, roughness: 0.7 });
        const pad = new THREE.Mesh(padGeom, padMat);
        pad.position.set(cx, height + 0.05, -cy - 5);
        pad.receiveShadow = true;
        parentMesh.add(pad);
    }

    // Solar panels for Civic/Institutional
    if (usage === 'Civic') {
        const panelGeom = new THREE.BoxGeometry(3, 0.1, 1.6);
        const panelMat = new THREE.MeshStandardMaterial({ color: 0x1d4ed8, roughness: 0.1 });
        for (let i = -1; i <= 1; i++) {
            const panel = new THREE.Mesh(panelGeom, panelMat);
            panel.rotation.x = -Math.PI / 6;
            panel.position.set(cx + i * 5, height + 0.5, -cy - 6);
            panel.castShadow = true;
            parentMesh.add(panel);
        }
    }
}

// 3D Semi-transparent Wireframe Zoning Envelope
function buildZoningEnvelope(item, insetRing, maxHeight, isViolated) {
    const envShape = new THREE.Shape();
    insetRing.forEach((pt, i) => {
        if (i === 0) envShape.moveTo(pt.x, pt.y);
        else envShape.lineTo(pt.x, pt.y);
    });

    const envGeom = new THREE.ExtrudeGeometry(envShape, { depth: maxHeight, bevelEnabled: false });
    envGeom.rotateX(-Math.PI / 2);
    envGeom.translate(0, maxHeight, 0);

    const envColor = isViolated ? 0xef4444 : 0x06b6d4; // Holographic cyan glow for compliance
    const envMat = new THREE.MeshStandardMaterial({
        color: envColor,
        transparent: true,
        opacity: isViolated ? 0.22 : 0.05,
        side: THREE.DoubleSide,
        depthWrite: false
    });

    const envMesh = new THREE.Mesh(envGeom, envMat);
    scene.add(envMesh);
    item.zoningMesh = envMesh;

    const edges = new THREE.EdgesGeometry(envGeom);
    const lineMat = new THREE.LineBasicMaterial({
        color: envColor,
        linewidth: 2.0,
        transparent: true,
        opacity: isViolated ? 0.8 : 0.45
    });
    const line = new THREE.LineSegments(edges, lineMat);
    envMesh.add(line);

    // Add dashed vertical column tracks at each corner of the zoning volume
    const colMat = new THREE.LineDashedMaterial({
        color: envColor,
        dashSize: 1.2,
        gapSize: 0.8,
        transparent: true,
        opacity: isViolated ? 0.85 : 0.55
    });

    insetRing.forEach(pt => {
        const points = [
            new THREE.Vector3(pt.x, 0.05, -pt.y),
            new THREE.Vector3(pt.x, maxHeight, -pt.y)
        ];
        const colGeom = new THREE.BufferGeometry().setFromPoints(points);
        const colLine = new THREE.Line(colGeom, colMat);
        colLine.computeLineDistances();
        envMesh.add(colLine);
    });
}

// Draw a red guideline if setback is too large to fit a building footprint
function drawSetbackErrorLine(item) {
    const borderPoints = item.outerRing.map(pt => new THREE.Vector3(pt.x, 0.15, -pt.y));
    borderPoints.push(borderPoints[0].clone());
    const errorGeom = new THREE.BufferGeometry().setFromPoints(borderPoints);
    const errorMat = new THREE.LineBasicMaterial({ color: 0xef4444, linewidth: 3 });
    const errorLine = new THREE.Line(errorGeom, errorMat);
    scene.add(errorLine);
    item.setbackMesh = errorLine;
}

// Generate animated low-poly traffic cars driving around parcel block perimeters
function generateTrafficCars() {
    // Clear old traffic cars
    trafficCars.forEach(car => {
        scene.remove(car.carMesh);
    });
    trafficCars = [];

    // Find suitable loop tracks: sidewalk boundaries expanded by 3.5m are roads!
    parcelFeatures.forEach(item => {
        const roadRing = offsetPolygonRing(item.outerRing, -4.5);
        if (!roadRing) return;

        // Spawn 2 cars per parcel block
        const colors = [0xef4444, 0x3b82f6, 0xf59e0b, 0x10b981];
        
        for (let i = 0; i < 2; i++) {
            const carColor = colors[Math.floor(Math.random() * colors.length)];
            const carMesh = buildDetailedCar(carColor, 1.35);
            scene.add(carMesh);

            trafficCars.push({
                carMesh: carMesh,
                roadRing: roadRing,
                speed: 0.0125 + Math.random() * 0.0125,
                progress: Math.random() * roadRing.length
            });
        }
    });

    // Make sure headlights match current slider value immediately
    updateSolarPhysics(parseFloat(inTime.value));
}

// Drive cars along their respective road loop loops
function updateTraffic() {
    trafficCars.forEach(car => {
        const ring = car.roadRing;
        car.progress += car.speed;
        
        // Find segment indices based on progress
        const idx1 = Math.floor(car.progress) % ring.length;
        const idx2 = (idx1 + 1) % ring.length;
        const segmentProgress = car.progress % 1.0;

        const pt1 = ring[idx1];
        const pt2 = ring[idx2];

        // Interpolate position
        const x = pt1.x + (pt2.x - pt1.x) * segmentProgress;
        const z = - (pt1.y + (pt2.y - pt1.y) * segmentProgress);

        car.carMesh.position.set(x, 0.05, z);

        // Calculate heading rotation
        const dx = pt2.x - pt1.x;
        const dy = pt2.y - pt1.y;
        const heading = Math.atan2(-dy, dx);
        car.carMesh.rotation.y = heading;
    });
}

// Helper to traverse up the parent chain to find the associated parcel item
function getParcelItemFromObject(obj) {
    let current = obj;
    while (current) {
        if (current.userData && current.userData.parcelItem) {
            return current.userData.parcelItem;
        }
        current = current.parent;
    }
    return null;
}

// Click listener to select building and open panel details
function onDocumentClick(event) {
    if (event.target.closest('#control-dock') || event.target.closest('.hud-bar') || event.target.closest('.loading-screen')) return;

    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    // Intercept click if in 3D Ruler Measurement mode
    if (isMeasurementMode) {
        const allIntersects = raycaster.intersectObjects(scene.children, true);
        const filtered = allIntersects.filter(hit => {
            return hit.object.type === 'Mesh' && 
                   !hit.object.userData?.isHeightHandle && 
                   !hit.object.userData?.isSetbackHandle && 
                   !hit.object.userData?.isMeasurementElement;
        });

        if (filtered.length > 0) {
            const hitPoint = filtered[0].point;
            handleMeasurementClick(hitPoint);
        }
        return;
    }

    if (heightHandleMesh) {
        const handleIntersects = raycaster.intersectObject(heightHandleMesh, true);
        if (handleIntersects.length > 0) return;
    }

    if (setbackHandleMesh) {
        const handleIntersects = raycaster.intersectObject(setbackHandleMesh, true);
        if (handleIntersects.length > 0) return;
    }

    const meshes = [];
    parcelFeatures.forEach(item => {
        if (item.parcelMesh) meshes.push(item.parcelMesh);
        if (item.buildingMesh) meshes.push(item.buildingMesh);
    });

    const intersects = raycaster.intersectObjects(meshes);

    if (intersects.length > 0) {
        const hitObject = intersects[0].object;
        const item = getParcelItemFromObject(hitObject);
        if (item) {
            selectParcel(item);
        }
    } else {
        deselectParcel();
    }
}

// Handle parcel selection, loading values to sliders
function selectParcel(item) {
    if (selectedParcel) {
        setBuildingHighlight(selectedParcel.buildingMesh, false);
    }

    selectedParcel = item;
    setBuildingHighlight(item.buildingMesh, true);

    // Populate sliders
    inSetback.value = item.params.setback;
    inFloors.value = item.params.floors;
    inFloorHeight.value = item.params.floorHeight;
    inTypology.value = item.params.typology;
    inUsage.value = item.params.usage;
    inRoofStyle.value = item.params.roofStyle || 'Flat';
    
    inStepbackInterval.value = item.params.stepbackInterval || 4;
    inStepbackDepth.value = item.params.stepbackDepth || 1.5;
    
    // Zoning sliders
    inMaxBcr.value = item.params.maxBcr;
    inMaxFar.value = item.params.maxFar;
    inMaxHeight.value = item.params.maxHeight;

    // Populate labels
    lblSetback.textContent = item.params.setback.toFixed(1);
    lblFloors.textContent = item.params.floors;
    lblFloorHeight.textContent = item.params.floorHeight.toFixed(1);
    lblMaxBcr.textContent = item.params.maxBcr.toFixed(2);
    lblMaxFar.textContent = item.params.maxFar.toFixed(1);
    lblMaxHeight.textContent = item.params.maxHeight.toFixed(1);
    
    lblStepbackInterval.textContent = item.params.stepbackInterval || 4;
    lblStepbackDepth.textContent = (item.params.stepbackDepth || 1.5).toFixed(1);

    // Show/hide stepped tower controls
    if (item.params.typology === 'SteppedTower') {
        steppedTowerControlsEl.classList.remove('hidden');
    } else {
        steppedTowerControlsEl.classList.add('hidden');
    }

    metFid.textContent = item.fid;
    metArea.textContent = Math.round(item.area).toLocaleString() + " m²";

    placeholderEl.classList.add('hidden');
    controlsEl.classList.remove('hidden');

    updateDashboard(item);

    // Spawn 3D arrow height handle on top of building and setback handle on ground
    if (item.params.usage !== 'Park') {
        let cx = 0, cy = 0;
        const ring = item.outerRing;
        ring.forEach(pt => { cx += pt.x; cy += pt.y; });
        cx /= ring.length;
        cy /= ring.length;

        const height = item.params.floors * item.params.floorHeight;
        spawnHeightHandle(cx, cy, height);

        // Spawn setback handle on first segment midpoint
        const insetRing = offsetPolygonRing(item.outerRing, item.params.setback);
        if (insetRing && insetRing.length >= 2) {
            const pt1 = insetRing[0];
            const pt2 = insetRing[1];
            spawnSetbackHandle((pt1.x + pt2.x) / 2, (pt1.y + pt2.y) / 2);
        } else {
            removeSetbackHandle();
        }
    } else {
        removeHeightHandle();
        removeSetbackHandle();
    }
}

// Deselect selected parcel and hide controls panel
function deselectParcel() {
    if (selectedParcel) {
        const prevSelected = selectedParcel;
        setBuildingHighlight(prevSelected.buildingMesh, false);
        selectedParcel = null;
        removeHeightHandle();
        removeSetbackHandle();
        rebuildParcel3D(prevSelected);
    }

    placeholderEl.classList.remove('hidden');
    controlsEl.classList.add('hidden');
}

// Helper to update opacity/emission highlights on building selection
function setBuildingHighlight(meshOrGroup, isSelected) {
    if (!meshOrGroup) return;
    const tVal = parseFloat(inTime.value);
    const isNight = tVal < 7.5 || tVal > 19.5;
    
    meshOrGroup.traverse(child => {
        if (child.isMesh && Array.isArray(child.material)) {
            const wallMat = child.material[1];
            if (wallMat) {
                wallMat.opacity = isSelected ? 1.0 : 0.85;
                if (isSelected) {
                    wallMat.emissive.setHex(0xaaaaaa); // selection highlight tint
                    wallMat.emissiveIntensity = 1.5;
                } else {
                    wallMat.emissive.setHex(0xffffff); // default emissiveMap color
                    wallMat.emissiveIntensity = isNight ? 1.0 : 0.0;
                }
            }
        }
    });
}

// Live calculation of regulatory compliance metrics (FAR, BCR, Height)
function updateDashboard(item) {
    const setback = item.params.setback;
    const floors = item.params.floors;
    const height = floors * item.params.floorHeight;
    
    // Calculate footprint area
    const insetRing = offsetPolygonRing(item.outerRing, setback);
    let footprintArea = 0;
    let gfa = 0;
    
    if (item.params.usage === 'Park') {
        footprintArea = 0;
        gfa = 0;
    } else if (insetRing && insetRing.length >= 3) {
        if (item.params.typology === 'Courtyard') {
            const innerSetback = 8;
            const innerRing = offsetPolygonRing(insetRing, innerSetback);
            const outerArea = calculatePolygonArea(insetRing);
            const innerArea = innerRing ? calculatePolygonArea(innerRing) : 0;
            footprintArea = Math.max(0, outerArea - innerArea);
            gfa = footprintArea * floors;
        } else if (item.params.typology === 'Slab') {
            const slabShape = buildSlabShape(insetRing, 12);
            footprintArea = calculateShapeArea(slabShape);
            gfa = footprintArea * floors;
        } else if (item.params.typology === 'LShape') {
            const lShape = buildLShape(insetRing, 12);
            footprintArea = calculateShapeArea(lShape);
            gfa = footprintArea * floors;
        } else if (item.params.typology === 'UShape') {
            const uShape = buildUShape(insetRing, 12);
            footprintArea = calculateShapeArea(uShape);
            gfa = footprintArea * floors;
        } else if (item.params.typology === 'PodiumTower') {
            const podiumArea = calculatePolygonArea(insetRing);
            const towerRing = offsetPolygonRing(insetRing, 3.5) || insetRing;
            const towerArea = calculatePolygonArea(towerRing);
            const podiumH = Math.min(height, 2 * item.params.floorHeight);
            const towerH = Math.max(0, height - podiumH);
            const podiumFloors = Math.round(podiumH / item.params.floorHeight);
            const towerFloors = Math.round(towerH / item.params.floorHeight);
            footprintArea = podiumArea;
            gfa = (podiumArea * podiumFloors) + (towerArea * towerFloors);
        } else if (item.params.typology === 'SteppedTower') {
            const stepInterval = item.params.stepbackInterval || 4;
            const stepDepth = item.params.stepbackDepth || 1.5;
            let remainingFloors = floors;
            let segmentIndex = 0;
            footprintArea = calculatePolygonArea(insetRing);
            gfa = 0;
            while (remainingFloors > 0) {
                const currentSetback = setback + segmentIndex * stepDepth;
                const segmentRing = offsetPolygonRing(item.outerRing, currentSetback);
                if (!segmentRing || segmentRing.length < 3) break;
                const segFloors = Math.min(stepInterval, remainingFloors);
                const segArea = calculatePolygonArea(segmentRing);
                gfa += segArea * segFloors;
                remainingFloors -= segFloors;
                segmentIndex++;
            }
        } else if (item.params.typology === 'MultiBuildingBlock') {
            const ob = getOrientedBounds(insetRing);
            const W = ob.W;
            const localRing = insetRing.map(pt => {
                const rx = pt.x - ob.cx;
                const ry = pt.y - ob.cy;
                return {
                    x: rx * ob.ux + ry * ob.uy,
                    y: rx * ob.nx + ry * ob.ny
                };
            });
            let footArea = 0;
            let totalGfa = 0;
            const floorsA = Math.round(floors * 1.3);
            const floorsB = Math.round(floors * 0.7);
            if (W >= 40) {
                const localPoly1 = clipConvexPolygonVertical(localRing, ob.minX, ob.minX + W * 0.38);
                const localPoly3 = clipConvexPolygonVertical(localRing, ob.minX + W * 0.62, ob.maxX);
                let insetPoly1 = null;
                let insetPoly3 = null;
                if (localPoly1 && localPoly1.length >= 3) {
                    const globalPoly1 = localPoly1.map(pt => ({
                        x: ob.cx + pt.x * ob.ux + pt.y * ob.nx,
                        y: ob.cy + pt.x * ob.uy + pt.y * ob.ny
                    }));
                    insetPoly1 = offsetPolygonRing(globalPoly1, 1.2);
                }
                if (localPoly3 && localPoly3.length >= 3) {
                    const globalPoly3 = localPoly3.map(pt => ({
                        x: ob.cx + pt.x * ob.ux + pt.y * ob.nx,
                        y: ob.cy + pt.x * ob.uy + pt.y * ob.ny
                    }));
                    insetPoly3 = offsetPolygonRing(globalPoly3, 1.2);
                }
                if (insetPoly1 && insetPoly1.length >= 3) {
                    const a1 = calculatePolygonArea(insetPoly1);
                    footArea += a1;
                    totalGfa += a1 * floorsA;
                }
                if (insetPoly3 && insetPoly3.length >= 3) {
                    const a3 = calculatePolygonArea(insetPoly3);
                    footArea += a3;
                    totalGfa += a3 * floorsB;
                }
            } else {
                const localPoly1 = clipConvexPolygonVertical(localRing, ob.minX, ob.minX + W * 0.5);
                let insetPoly1 = null;
                if (localPoly1 && localPoly1.length >= 3) {
                    const globalPoly1 = localPoly1.map(pt => ({
                        x: ob.cx + pt.x * ob.ux + pt.y * ob.nx,
                        y: ob.cy + pt.x * ob.uy + pt.y * ob.ny
                    }));
                    insetPoly1 = offsetPolygonRing(globalPoly1, 1.2);
                }
                if (insetPoly1 && insetPoly1.length >= 3) {
                    const a1 = calculatePolygonArea(insetPoly1);
                    footArea += a1;
                    totalGfa += a1 * floors;
                }
            }
            footprintArea = footArea;
            gfa = totalGfa;
        } else { // Tower
            footprintArea = calculatePolygonArea(insetRing);
            gfa = footprintArea * floors;
        }
    }

    const bcr = item.area > 0 ? (footprintArea / item.area) : 0;
    const far = item.area > 0 ? (gfa / item.area) : 0;

    // Update UI elements
    metFootprint.textContent = Math.round(footprintArea).toLocaleString() + " m²";
    metGfa.textContent = Math.round(gfa).toLocaleString() + " m²";
    metHeight.textContent = item.params.usage === 'Park' ? "0.0 m" : height.toFixed(1) + " m";
    
    // Actual vs Limit Text Labels
    metBcrLabel.textContent = `${bcr.toFixed(2)} / ${item.params.maxBcr.toFixed(2)}`;
    metFarLabel.textContent = `${far.toFixed(2)} / ${item.params.maxFar.toFixed(2)}`;

    // Update Visual Gauge Bars widths
    const bcrPercent = Math.min(100, (bcr / item.params.maxBcr) * 100);
    const farPercent = Math.min(100, (far / item.params.maxFar) * 100);

    bcrFillEl.style.width = `${bcrPercent}%`;
    farFillEl.style.width = `${farPercent}%`;

    // Colors of progress bars based on violations
    const bcrViolated = bcr > item.params.maxBcr;
    bcrFillEl.className = `gauge-bar-fill ${bcrViolated ? "red-bar" : "green-bar"}`;
    metBcrLabel.style.color = bcrViolated ? "#ef4444" : "#10b981";

    const farViolated = far > item.params.maxFar;
    farFillEl.className = `gauge-bar-fill ${farViolated ? "red-bar" : "green-bar"}`;
    metFarLabel.style.color = farViolated ? "#ef4444" : "#10b981";

    const heightViolated = height > item.params.maxHeight;
    metHeight.style.color = heightViolated ? "#ef4444" : "#10b981";

    const violated = heightViolated || bcrViolated || farViolated || footprintArea === 0;
    
    metStatus.textContent = violated ? "VIOLATION" : "COMPLIANT";
    metStatus.className = "stat-val status-badge " + (violated ? "violation" : "compliant");

    // ── Population Estimator ──
    const usage = item.params.usage;
    let dwellingUnits = 0;
    let population = 0;
    const AVG_UNIT_SIZE = 100; // m² per dwelling unit
    const AVG_PERSONS = 2.8;   // persons per household

    if (usage === 'Residential') {
        dwellingUnits = Math.floor(gfa / AVG_UNIT_SIZE);
        population = Math.round(dwellingUnits * AVG_PERSONS);
    } else if (usage === 'MixedUse') {
        // Ground floor commercial (assume 1 floor retail), rest residential
        const residentialGfa = Math.max(0, gfa - footprintArea);
        dwellingUnits = Math.floor(residentialGfa / AVG_UNIT_SIZE);
        population = Math.round(dwellingUnits * AVG_PERSONS);
    } else if (usage === 'Commercial' || usage === 'Civic') {
        // Estimate workforce: 1 person per 15m² office/commercial
        dwellingUnits = 0;
        population = Math.round(gfa / 15);
    }

    const densityPpHa = item.area > 0 ? Math.round(population / (item.area / 10000)) : 0;

    if (metUnits) metUnits.textContent = usage === 'Park' ? '0' : dwellingUnits.toLocaleString();
    if (metPopulation) metPopulation.textContent = usage === 'Park' ? '0' : population.toLocaleString();
    if (metDensity) metDensity.textContent = usage === 'Park' ? '0 pp/ha' : `${densityPpHa.toLocaleString()} pp/ha`;

    // ── Sustainability Indicators ──
    const osr = gfa > 0 ? ((item.area - footprintArea) / gfa) : 0;
    
    let carbonFactor = 0;
    if (usage === 'Residential') carbonFactor = 0.045;
    else if (usage === 'MixedUse') carbonFactor = 0.055;
    else if (usage === 'Commercial') carbonFactor = 0.075;
    else if (usage === 'Civic') carbonFactor = 0.050;
    const carbon = gfa * carbonFactor;

    const runoff = bcr * 0.90 + (1 - bcr) * 0.15;

    if (metOsr) metOsr.textContent = gfa > 0 ? osr.toFixed(2) : 'N/A';
    if (metCarbon) metCarbon.textContent = carbon > 0 ? `${Math.round(carbon).toLocaleString()} t CO2e/yr` : '0 t CO2e/yr';
    if (metRunoff) metRunoff.textContent = runoff.toFixed(2);
}

// Capture current 3D WebGL viewport canvas as a PNG screenshot download
function captureViewport() {
    try {
        // Redraw scene through post-processing pipeline
        composer.render();
        const dataURL = renderer.domElement.toDataURL('image/png');
        
        const link = document.createElement('a');
        link.download = 'planx_urban_design_capture.png';
        link.href = dataURL;
        link.click();
    } catch (e) {
        console.error(e);
        alert("Failed to capture viewport screenshot.");
    }
}

// Export complete planning and sustainability parameters for all parcels as a CSV report
function exportPlanningReport() {
    try {
        if (!parcelFeatures || parcelFeatures.length === 0) {
            alert("No parcel data available to export.");
            return;
        }

        const headers = [
            "Parcel ID",
            "Area (sq m)",
            "Primary Use",
            "Typology",
            "Roof Style",
            "Setback Distance (m)",
            "Floor Count",
            "Floor Height (m)",
            "Max BCR (Allowed)",
            "Max FAR (Allowed)",
            "Max Height (Allowed)",
            "Actual Footprint Area (sq m)",
            "Actual GFA (sq m)",
            "Actual Height (m)",
            "Actual BCR",
            "Actual FAR",
            "Compliance Status",
            "Est. Dwelling Units",
            "Est. Population",
            "Pop. Density (pp/ha)",
            "Open Space Ratio (OSR)",
            "Est. Carbon Footprint (t CO2e/yr)",
            "Stormwater Runoff Coefficient"
        ];

        const rows = [headers.join(",")];

        parcelFeatures.forEach(item => {
            const setback = item.params.setback;
            const floors = item.params.floors;
            const floorHeight = item.params.floorHeight;
            const height = floors * floorHeight;
            const typology = item.params.typology;
            const usage = item.params.usage;
            
            // Calculate footprint area and GFA
            const insetRing = offsetPolygonRing(item.outerRing, setback);
            let footprintArea = 0;
            let gfa = 0;
            
            if (usage === 'Park') {
                footprintArea = 0;
                gfa = 0;
            } else if (insetRing && insetRing.length >= 3) {
                if (typology === 'Courtyard') {
                    const innerSetback = 8;
                    const innerRing = offsetPolygonRing(insetRing, innerSetback);
                    const outerArea = calculatePolygonArea(insetRing);
                    const innerArea = innerRing ? calculatePolygonArea(innerRing) : 0;
                    footprintArea = Math.max(0, outerArea - innerArea);
                    gfa = footprintArea * floors;
                } else if (typology === 'Slab') {
                    const slabShape = buildSlabShape(insetRing, 12);
                    footprintArea = calculateShapeArea(slabShape);
                    gfa = footprintArea * floors;
                } else if (typology === 'LShape') {
                    const lShape = buildLShape(insetRing, 12);
                    footprintArea = calculateShapeArea(lShape);
                    gfa = footprintArea * floors;
                } else if (typology === 'UShape') {
                    const uShape = buildUShape(insetRing, 12);
                    footprintArea = calculateShapeArea(uShape);
                    gfa = footprintArea * floors;
                } else if (typology === 'PodiumTower') {
                    const podiumArea = calculatePolygonArea(insetRing);
                    const towerRing = offsetPolygonRing(insetRing, 3.5) || insetRing;
                    const towerArea = calculatePolygonArea(towerRing);
                    const podiumH = Math.min(height, 2 * floorHeight);
                    const towerH = Math.max(0, height - podiumH);
                    const podiumFloors = Math.round(podiumH / floorHeight);
                    const towerFloors = Math.round(towerH / floorHeight);
                    footprintArea = podiumArea;
                    gfa = (podiumArea * podiumFloors) + (towerArea * towerFloors);
                } else if (typology === 'SteppedTower') {
                    const stepInterval = item.params.stepbackInterval || 4;
                    const stepDepth = item.params.stepbackDepth || 1.5;
                    let remainingFloors = floors;
                    let segmentIndex = 0;
                    footprintArea = calculatePolygonArea(insetRing);
                    gfa = 0;
                    while (remainingFloors > 0) {
                        const currentSetback = setback + segmentIndex * stepDepth;
                        const segmentRing = offsetPolygonRing(item.outerRing, currentSetback);
                        if (!segmentRing || segmentRing.length < 3) break;
                        const segFloors = Math.min(stepInterval, remainingFloors);
                        const segArea = calculatePolygonArea(segmentRing);
                        gfa += segArea * segFloors;
                        remainingFloors -= segFloors;
                        segmentIndex++;
                    }
                } else { // Tower
                    footprintArea = calculatePolygonArea(insetRing);
                    gfa = footprintArea * floors;
                }
            }

            const bcr = item.area > 0 ? (footprintArea / item.area) : 0;
            const far = item.area > 0 ? (gfa / item.area) : 0;

            const heightViolation = usage !== 'Park' && height > item.params.maxHeight;
            const bcrViolation = bcr > item.params.maxBcr;
            const farViolation = far > item.params.maxFar;
            const violated = heightViolation || bcrViolation || farViolation || (usage !== 'Park' && footprintArea === 0);
            const status = violated ? "VIOLATION" : "COMPLIANT";

            // Dwelling units and population
            let dwellingUnits = 0;
            let population = 0;
            const AVG_UNIT_SIZE = 100;
            const AVG_PERSONS = 2.8;

            if (usage === 'Residential') {
                dwellingUnits = Math.floor(gfa / AVG_UNIT_SIZE);
                population = Math.round(dwellingUnits * AVG_PERSONS);
            } else if (usage === 'MixedUse') {
                const residentialGfa = Math.max(0, gfa - footprintArea);
                dwellingUnits = Math.floor(residentialGfa / AVG_UNIT_SIZE);
                population = Math.round(dwellingUnits * AVG_PERSONS);
            } else if (usage === 'Commercial' || usage === 'Civic') {
                dwellingUnits = 0;
                population = Math.round(gfa / 15);
            }
            const densityPpHa = item.area > 0 ? Math.round(population / (item.area / 10000)) : 0;

            // Sustainability
            const osr = gfa > 0 ? ((item.area - footprintArea) / gfa) : 0;
            let carbonFactor = 0;
            if (usage === 'Residential') carbonFactor = 0.045;
            else if (usage === 'MixedUse') carbonFactor = 0.055;
            else if (usage === 'Commercial') carbonFactor = 0.075;
            else if (usage === 'Civic') carbonFactor = 0.050;
            const carbon = gfa * carbonFactor;
            const runoff = bcr * 0.90 + (1 - bcr) * 0.15;

            const row = [
                item.fid !== undefined ? item.fid : "",
                item.area.toFixed(1),
                usage,
                typology,
                item.params.roofStyle || "Flat",
                setback.toFixed(1),
                floors,
                floorHeight.toFixed(1),
                item.params.maxBcr.toFixed(2),
                item.params.maxFar.toFixed(2),
                item.params.maxHeight.toFixed(1),
                footprintArea.toFixed(1),
                gfa.toFixed(1),
                (usage === 'Park' ? 0 : height).toFixed(1),
                bcr.toFixed(3),
                far.toFixed(3),
                status,
                dwellingUnits,
                population,
                densityPpHa,
                gfa > 0 ? osr.toFixed(3) : "N/A",
                carbon.toFixed(1),
                runoff.toFixed(3)
            ];

            const csvRow = row.map(val => {
                const s = String(val);
                if (s.includes(",") || s.includes("\"") || s.includes("\n")) {
                    return `"${s.replace(/"/g, '""')}"`;
                }
                return s;
            }).join(",");

            rows.push(csvRow);
        });

        const csvContent = "\ufeff" + rows.join("\n"); // Add BOM for Excel compatibility
        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", "planx_urban_planning_report.csv");
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    } catch (e) {
        console.error(e);
        alert("Failed to export planning report CSV.");
    }
}

// POST modifications back to the local Python QGIS server
async function syncToQGIS() {
    let modifiedParcels = parcelFeatures.filter(item => item.modified);
    
    // Fallback: If no parcels are flagged as modified, but one is selected, sync that selected one
    if (modifiedParcels.length === 0 && selectedParcel) {
        selectedParcel.modified = true;
        modifiedParcels = [selectedParcel];
    }
    
    if (modifiedParcels.length === 0) {
        alert("No modifications to synchronize. Select a parcel and adjust sliders first.");
        return;
    }

    btnSync.disabled = true;
    btnSync.textContent = "Syncing...";

    const updates = modifiedParcels.map(item => {
        const setback = item.params.setback;
        const insetRing = offsetPolygonRing(item.outerRing, setback);
        
        let geoCoords = [];
        if (insetRing) {
            geoCoords = insetRing.map(pt => {
                return [pt.x + centerX, pt.y + centerY];
            });
        }
        
        // Calculate FAR and BCR actuals based on geometry typology
        let footprintArea = 0;
        let gfa = 0;
        const height = item.params.floors * item.params.floorHeight;
        
        if (item.params.usage !== 'Park') {
            if (item.params.typology === 'Courtyard') {
                const innerSetback = 8;
                const innerRing = offsetPolygonRing(insetRing, innerSetback);
                const outerArea = calculatePolygonArea(insetRing);
                const innerArea = innerRing ? calculatePolygonArea(innerRing) : 0;
                footprintArea = Math.max(0, outerArea - innerArea);
                gfa = footprintArea * item.params.floors;
            } else if (item.params.typology === 'Slab') {
                const slabShape = buildSlabShape(insetRing, 12);
                footprintArea = calculateShapeArea(slabShape);
                gfa = footprintArea * item.params.floors;
            } else if (item.params.typology === 'LShape') {
                const lShape = buildLShape(insetRing, 12);
                footprintArea = calculateShapeArea(lShape);
                gfa = footprintArea * item.params.floors;
            } else if (item.params.typology === 'UShape') {
                const uShape = buildUShape(insetRing, 12);
                footprintArea = calculateShapeArea(uShape);
                gfa = footprintArea * item.params.floors;
            } else if (item.params.typology === 'PodiumTower') {
                const podiumH = Math.min(height, 2 * item.params.floorHeight);
                const towerH = Math.max(0, height - podiumH);
                const podiumArea = calculatePolygonArea(insetRing);
                const towerRing = offsetPolygonRing(insetRing, 3.5) || insetRing;
                const towerArea = calculatePolygonArea(towerRing);
                const podiumFloors = Math.round(podiumH / item.params.floorHeight);
                const towerFloors = Math.round(towerH / item.params.floorHeight);
                footprintArea = podiumArea;
                gfa = (podiumArea * podiumFloors) + (towerArea * towerFloors);
            } else if (item.params.typology === 'SteppedTower') {
                const stepInterval = item.params.stepbackInterval || 4;
                const stepDepth = item.params.stepbackDepth || 1.5;
                let remainingFloors = item.params.floors;
                let segmentIndex = 0;
                footprintArea = calculatePolygonArea(insetRing);
                gfa = 0;
                while (remainingFloors > 0) {
                    const currentSetback = setback + segmentIndex * stepDepth;
                    const segmentRing = offsetPolygonRing(item.outerRing, currentSetback);
                    if (!segmentRing || segmentRing.length < 3) break;
                    const segFloors = Math.min(stepInterval, remainingFloors);
                    const segArea = calculatePolygonArea(segmentRing);
                    gfa += segArea * segFloors;
                    remainingFloors -= segFloors;
                    segmentIndex++;
                }
            } else { // Tower
                footprintArea = calculatePolygonArea(insetRing);
                gfa = footprintArea * item.params.floors;
            }
        }
        
        const bcr = item.area > 0 ? (footprintArea / item.area) : 0;
        const far = item.area > 0 ? (gfa / item.area) : 0;
        
        return {
            id: item.fid,
            far: parseFloat(far.toFixed(2)),
            bcr: parseFloat(bcr.toFixed(2)),
            gfa: Math.round(gfa),
            setback: item.params.setback,
            floors: item.params.floors,
            floor_h: item.params.floorHeight,
            typology: item.params.typology,
            usage: item.params.usage,
            max_bcr: item.params.maxBcr,
            max_far: item.params.maxFar,
            max_height: item.params.maxHeight,
            roof_style: item.params.roofStyle || 'Flat',
            stepback_i: item.params.stepbackInterval || 4,
            stepback_d: item.params.stepbackDepth || 1.5,
            coordinates: geoCoords
        };
    });

    const payload = { updates };

    try {
        const response = await fetch('/sync', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const res = await response.json();
        if (res.status === 'ok') {
            modifiedParcels.forEach(item => { item.modified = false; });
            alert(`Successfully synced ${modifiedParcels.length} parcel modifications back to QGIS!`);
        } else {
            alert("Synchronization failed:\n" + res.message);
        }
    } catch (e) {
        console.error(e);
        alert("Connection error: Could not reach QGIS plugin server.");
    } finally {
        btnSync.disabled = false;
        btnSync.textContent = "Sync Parameters to QGIS";
    }
}

// ───────────────────────── Mathematical Geometry Helpers ─────────────────────────

// Standard Polygon Area calculation (Shoelace formula)
function calculatePolygonArea(ring) {
    let area = 0;
    const N = ring.length;
    for (let i = 0; i < N; i++) {
        const p1 = ring[i];
        const p2 = ring[(i + 1) % N];
        area += p1.x * p2.y - p2.x * p1.y;
    }
    return Math.abs(area / 2);
}

// Calculate area of a THREE.Shape
function calculateShapeArea(shape) {
    const pts = shape.getPoints();
    return calculatePolygonArea(pts.map(pt => { return {x: pt.x, y: pt.y}; }));
}

// Perform polygon segment corner-bisector offsetting/insetting
function offsetPolygonRing(ring, distance) {
    if (Math.abs(distance) <= 0.05) return ring.map(pt => { return {x: pt.x, y: pt.y}; });

    // Detect winding order and flip distance if clockwise to ensure consistent inward/outward behavior
    let sum = 0;
    const N = ring.length;
    for (let i = 0; i < N; i++) {
        const p1 = ring[i];
        const p2 = ring[(i + 1) % N];
        sum += (p2.x - p1.x) * (p2.y + p1.y);
    }
    const activeDistance = (sum > 0) ? -distance : distance;

    const N_pts = ring.length;
    const offsetSegments = [];

    // Calculate inward shifted segments
    for (let i = 0; i < N_pts; i++) {
        const p1 = ring[i];
        const p2 = ring[(i + 1) % N_pts];

        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const len = Math.sqrt(dx*dx + dy*dy);
        if (len < 0.001) continue;

        // Inward pointing normal
        const nx = -dy / len;
        const ny = dx / len;

        offsetSegments.push({
            p1: { x: p1.x + nx * activeDistance, y: p1.y + ny * activeDistance },
            p2: { x: p2.x + nx * activeDistance, y: p2.y + ny * activeDistance },
            dir: { x: dx / len, y: dy / len }
        });
    }

    if (offsetSegments.length < 3) return null;

    // Intersect adjacent shifted segments to find new vertices
    const insetRing = [];
    const M = offsetSegments.length;
    for (let i = 0; i < M; i++) {
        const s1 = offsetSegments[(i - 1 + M) % M];
        const s2 = offsetSegments[i];

        const pt = intersectLines(s1.p1, s1.dir, s2.p1, s2.dir);
        if (pt) {
            const d1 = distToSegment(pt, ring[(i - 1 + M) % M], ring[i]);
            const checkDist = Math.abs(activeDistance);
            if (d1 > checkDist * 4) return null; // self-intersection/degenerate
            insetRing.push(pt);
        } else {
            insetRing.push({ x: s2.p1.x, y: s2.p1.y });
        }
    }

    return insetRing;
}

// Find intersection point of two infinite 2D lines
function intersectLines(p1, d1, p2, d2) {
    const denom = d1.x * d2.y - d1.y * d2.x;
    if (Math.abs(denom) < 0.0001) return null;

    const t = ((p2.x - p1.x) * d2.y - (p2.y - p1.y) * d2.x) / denom;
    return {
        x: p1.x + d1.x * t,
        y: p1.y + d1.y * t
    };
}

// Distance from point to line segment
function distToSegment(p, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx*dx + dy*dy;
    if (l2 === 0) return Math.sqrt((p.x - a.x)**2 + (p.y - a.y)**2);
    
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    
    const projX = a.x + t * dx;
    const projY = a.y + t * dy;
    return Math.sqrt((p.x - projX)**2 + (p.y - projY)**2);
}

// Generate a rectangular Slab/Row building footprint along the longest side
function buildSlabShape(ring, width) {
    let maxLen = -1;
    let bestStart = null, bestEnd = null;
    const N = ring.length;
    
    for (let i = 0; i < N; i++) {
        const p1 = ring[i];
        const p2 = ring[(i + 1) % N];
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const len = Math.sqrt(dx*dx + dy*dy);
        if (len > maxLen) {
            maxLen = len;
            bestStart = p1;
            bestEnd = p2;
        }
    }

    let cx = 0, cy = 0;
    ring.forEach(pt => { cx += pt.x; cy += pt.y; });
    cx /= N;
    cy /= N;

    const dx = bestEnd.x - bestStart.x;
    const dy = bestEnd.y - bestStart.y;
    const len = Math.sqrt(dx*dx + dy*dy);
    const ux = dx / len;
    const uy = dy / len;

    const nx = -uy;
    const ny = ux;

    const slabLength = maxLen * 0.9;
    const shape = new THREE.Shape();
    
    const wHalf = width / 2;
    const lHalf = slabLength / 2;

    const c1x = cx - ux * lHalf - nx * wHalf;
    const c1y = cy - uy * lHalf - ny * wHalf;

    const c2x = cx + ux * lHalf - nx * wHalf;
    const c2y = cy + uy * lHalf - ny * wHalf;

    const c3x = cx + ux * lHalf + nx * wHalf;
    const c3y = cy + uy * lHalf + ny * wHalf;

    const c4x = cx - ux * lHalf + nx * wHalf;
    const c4y = cy - uy * lHalf + ny * wHalf;

    shape.moveTo(c1x, c1y);
    shape.lineTo(c2x, c2y);
    shape.lineTo(c3x, c3y);
    shape.lineTo(c4x, c4y);

    return shape;
}

// Start the application
init();

// ───────────────────────── Keyboard Shortcuts ─────────────────────────
function handleKeyboardShortcuts(event) {
    // Ignore shortcuts when typing in inputs
    if (event.target.tagName === 'INPUT' || event.target.tagName === 'SELECT' || event.target.tagName === 'TEXTAREA') return;

    switch (event.key.toLowerCase()) {
        case 'r': // Reset camera
            camera.position.set(0, 300, 450);
            controls.target.set(0, 0, 0);
            controls.update();
            break;

        case 'f': // Focus on selected parcel
            if (selectedParcel && selectedParcel.buildingMesh) {
                const box = new THREE.Box3().setFromObject(selectedParcel.buildingMesh);
                const center = box.getCenter(new THREE.Vector3());
                const size = box.getSize(new THREE.Vector3());
                const maxDim = Math.max(size.x, size.y, size.z);

                controls.target.copy(center);
                camera.position.set(
                    center.x + maxDim * 1.2,
                    center.y + maxDim * 0.8,
                    center.z + maxDim * 1.2
                );
                controls.update();
            }
            break;

        case 'n': // Toggle night mode
            {
                const currentTime = parseFloat(inTime.value);
                const isCurrentlyNight = currentTime < 7.5 || currentTime > 19.5;
                const newTime = isCurrentlyNight ? 12.0 : 21.0;
                inTime.value = newTime;
                const hours = Math.floor(newTime);
                const mins = (newTime % 1) === 0 ? "00" : "30";
                lblTime.textContent = `${hours}:${mins}`;
                updateSolarPhysics(newTime);
            }
            break;

        case 'g': // Toggle grid visibility
            if (gridHelper) {
                gridHelper.visible = !gridHelper.visible;
                if (toggleGridEl) {
                    toggleGridEl.checked = gridHelper.visible;
                }
            }
            break;
    }
}

// ───────────────────────── Apply To All Parcels ─────────────────────────
function applyToAllParcels() {
    if (!selectedParcel) {
        alert('Please select a parcel first to use as the template.');
        return;
    }

    const templateParams = { ...selectedParcel.params };

    const confirmed = confirm(
        `Apply the current design parameters to all ${parcelFeatures.length} parcels?\n\n` +
        `Typology: ${templateParams.typology}\n` +
        `Usage: ${templateParams.usage}\n` +
        `Roof Style: ${templateParams.roofStyle || 'Flat'}\n` +
        `Floors: ${templateParams.floors}\n` +
        `Floor Height: ${templateParams.floorHeight}m\n` +
        `Setback: ${templateParams.setback}m\n\n` +
        `This action cannot be undone.`
    );

    if (!confirmed) return;

    btnApplyAll.disabled = true;
    btnApplyAll.textContent = 'Applying...';

    parcelFeatures.forEach(item => {
        item.modified = true;
        item.params.setback = templateParams.setback;
        item.params.floors = templateParams.floors;
        item.params.floorHeight = templateParams.floorHeight;
        item.params.typology = templateParams.typology;
        item.params.usage = templateParams.usage;
        item.params.roofStyle = templateParams.roofStyle;
        item.params.stepbackInterval = templateParams.stepbackInterval;
        item.params.stepbackDepth = templateParams.stepbackDepth;
        item.params.maxBcr = templateParams.maxBcr;
        item.params.maxFar = templateParams.maxFar;
        item.params.maxHeight = templateParams.maxHeight;

        rebuildParcel3D(item);
    });

    // Refresh dashboard for selected
    updateDashboard(selectedParcel);

    btnApplyAll.disabled = false;
    btnApplyAll.textContent = 'Apply to All Parcels';
}

// ───────────────────────── WebGL Memory & Resource Cleanup ─────────────────────────

function clearScene() {
    // 1. Deselect any active parcel
    deselectParcel();

    // 2. Remove and dispose parcelFeatures elements
    parcelFeatures.forEach(item => {
        // Remove and dispose parcelMesh
        if (item.parcelMesh) {
            scene.remove(item.parcelMesh);
            if (item.parcelMesh.geometry) item.parcelMesh.geometry.dispose();
            disposeMaterialOrMaterials(item.parcelMesh.material);
        }

        // Remove and dispose buildingMesh
        if (item.buildingMesh) {
            scene.remove(item.buildingMesh);
            disposeObject3D(item.buildingMesh);
        }

        // Remove and dispose setbackMesh
        if (item.setbackMesh) {
            scene.remove(item.setbackMesh);
            if (item.setbackMesh.geometry) item.setbackMesh.geometry.dispose();
            disposeMaterialOrMaterials(item.setbackMesh.material);
        }

        // Remove and dispose sidewalkMesh
        if (item.sidewalkMesh) {
            scene.remove(item.sidewalkMesh);
            disposeObject3D(item.sidewalkMesh);
        }

        // Remove and dispose zoningMesh
        if (item.zoningMesh) {
            scene.remove(item.zoningMesh);
            disposeObject3D(item.zoningMesh);
        }
    });
    parcelFeatures = [];

    // 3. Remove and dispose pedestrians
    pedestrians.forEach(ped => {
        if (ped.mesh) {
            scene.remove(ped.mesh);
            disposeObject3D(ped.mesh);
        }
    });
    pedestrians = [];

    // 4. Remove and dispose traffic cars
    trafficCars.forEach(car => {
        if (car.carMesh) {
            scene.remove(car.carMesh);
            disposeObject3D(car.carMesh);
        }
    });
    trafficCars = [];
}

// Deep dispose helper for geometry, material, textures
function disposeObject3D(obj) {
    obj.traverse(child => {
        if (child.isMesh) {
            if (child.geometry) child.geometry.dispose();
            disposeMaterialOrMaterials(child.material);
        }
    });
}

function disposeMaterialOrMaterials(material) {
    if (!material) return;
    if (Array.isArray(material)) {
        material.forEach(m => disposeSingleMaterial(m));
    } else {
        disposeSingleMaterial(material);
    }
}

function disposeSingleMaterial(m) {
    if (!m) return;
    if (m.map) m.map.dispose();
    if (m.lightMap) m.lightMap.dispose();
    if (m.bumpMap) m.bumpMap.dispose();
    if (m.normalMap) m.normalMap.dispose();
    if (m.specularMap) m.specularMap.dispose();
    if (m.envMap) m.envMap.dispose();
    if (m.alphaMap) m.alphaMap.dispose();
    if (m.aoMap) m.aoMap.dispose();
    if (m.displacementMap) m.displacementMap.dispose();
    if (m.emissiveMap) m.emissiveMap.dispose();
    if (m.roughnessMap) m.roughnessMap.dispose();
    if (m.metalnessMap) m.metalnessMap.dispose();
    m.dispose();
}

// ───────────────────────── Dynamic Layers Visibility ─────────────────────────

function updateLayersVisibility() {
    const showBuildings = toggleBuildingsEl ? toggleBuildingsEl.checked : true;
    const showZoning = toggleZoningEl ? toggleZoningEl.checked : true;
    const showSetbacks = toggleSetbacksEl ? toggleSetbacksEl.checked : true;
    const showSidewalks = toggleSidewalksEl ? toggleSidewalksEl.checked : true;
    const showPedestrians = togglePedestriansEl ? togglePedestriansEl.checked : true;
    const showTraffic = toggleTrafficEl ? toggleTrafficEl.checked : true;
    const showGrid = toggleGridEl ? toggleGridEl.checked : true;

    // Toggle grid
    if (gridHelper) {
        gridHelper.visible = showGrid;
    }

    // Toggle features
    parcelFeatures.forEach(item => {
        if (item.buildingMesh) {
            item.buildingMesh.visible = showBuildings;
        }
        if (item.zoningMesh) {
            item.zoningMesh.visible = showZoning;
        }
        if (item.setbackMesh) {
            item.setbackMesh.visible = showSetbacks;
        }
        if (item.sidewalkMesh) {
            item.sidewalkMesh.visible = showSidewalks;
        }
    });

    // Toggle pedestrian meshes
    pedestrians.forEach(ped => {
        if (ped.mesh) ped.mesh.visible = showPedestrians;
    });

    // Toggle traffic car meshes
    trafficCars.forEach(car => {
        if (car.carMesh) car.carMesh.visible = showTraffic;
    });
}

// ───────────────────────── Reload Data from QGIS ─────────────────────────

async function reloadData() {
    if (btnReload) {
        btnReload.disabled = true;
        btnReload.textContent = "Reloading...";
    }
    
    // Re-show loading screen
    if (loadingEl) {
        loadingEl.style.opacity = 1;
        loadingEl.classList.remove('hidden');
        const textEl = document.getElementById('loading-text');
        if (textEl) textEl.innerText = "Reloading layer features from QGIS...";
    }

    try {
        const response = await fetch('/data.geojson');
        if (!response.ok) throw new Error("Could not load data");
        
        const data = await response.json();
        parseGeoJSON(data);
        
        // Hide loading screen
        if (loadingEl) {
            loadingEl.style.opacity = 0;
            setTimeout(() => loadingEl.classList.add('hidden'), 500);
        }
        
        // Keep checkboxes synchronized after reload
        updateLayersVisibility();
        
    } catch (e) {
        console.error(e);
        const textEl = document.getElementById('loading-text');
        if (textEl) textEl.innerText = "ERROR: Failed to reload. Verify QGIS server connection.";
    } finally {
        if (btnReload) {
            btnReload.disabled = false;
            btnReload.textContent = "Reload Data from QGIS";
        }
    }
}

// ───────────────────────── Pointer Hover highlights ─────────────────────────

let hoveredParcel = null;

function onPointerMove(event) {
    if (event.target.closest('#control-dock') || event.target.closest('.hud-bar') || event.target.closest('.loading-screen')) {
        document.body.style.cursor = 'default';
        return;
    }

    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    // Render temporary measurement line in Measurement Mode
    if (isMeasurementMode) {
        document.body.style.cursor = 'crosshair';
        
        if (measurementPoints.length === 1 && tempMeasureLine) {
            const allIntersects = raycaster.intersectObjects(scene.children, true);
            const filtered = allIntersects.filter(hit => {
                return hit.object.type === 'Mesh' && 
                       !hit.object.userData?.isHeightHandle && 
                       !hit.object.userData?.isSetbackHandle && 
                       !hit.object.userData?.isMeasurementElement;
            });

            if (filtered.length > 0) {
                const hitPoint = filtered[0].point;
                const start = measurementPoints[0];
                
                const positions = new Float32Array([
                    start.x, start.y, start.z,
                    hitPoint.x, hitPoint.y, hitPoint.z
                ]);
                tempMeasureLine.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
                tempMeasureLine.geometry.attributes.position.needsUpdate = true;
                tempMeasureLine.geometry.computeBoundingSphere();
                tempMeasureLine.geometry.computeBoundingBox();
                tempMeasureLine.visible = true;
                
                // Show dynamic temporary label
                if (tempMeasureLabel) {
                    tempMeasureLabel.style.display = 'block';
                }
            }
        }
        return;
    }

    // 1. If actively dragging the setback handle
    if (isDraggingSetback && selectedParcel && setbackHandleMesh) {
        const intersectPoint = new THREE.Vector3();
        raycaster.ray.intersectPlane(dragIntersectionPlane, intersectPoint);
        
        const pt = { x: intersectPoint.x, y: -intersectPoint.z };
        const newSetback = getDistanceToPolygon(pt, selectedParcel.outerRing);
        const clampedSetback = Math.max(0, Math.min(15, Math.round(newSetback * 2) / 2)); // step = 0.5
        
        if (clampedSetback !== selectedParcel.params.setback) {
            selectedParcel.params.setback = clampedSetback;
            inSetback.value = clampedSetback;
            lblSetback.textContent = clampedSetback.toFixed(1);
            selectedParcel.modified = true;
            
            rebuildParcel3D(selectedParcel);
            updateDashboard(selectedParcel);
            updateHeightHandle();
            updateSetbackHandle();
        }
        document.body.style.cursor = 'ew-resize';
        return;
    }

    // 2. If actively dragging the height handle
    if (isDraggingHeight && selectedParcel && heightHandleMesh) {
        const intersectPoint = new THREE.Vector3();
        raycaster.ray.intersectPlane(dragIntersectionPlane, intersectPoint);

        const deltaY = intersectPoint.y - dragStartHeight;
        const floorH = selectedParcel.params.floorHeight;
        const deltaFloors = Math.round(deltaY / floorH);
        
        const newFloors = Math.max(1, Math.min(30, dragStartFloors + deltaFloors));
        if (newFloors !== selectedParcel.params.floors) {
            inFloors.value = newFloors;
            lblFloors.textContent = newFloors;
            selectedParcel.params.floors = newFloors;
            selectedParcel.modified = true;
            
            rebuildParcel3D(selectedParcel);
            updateDashboard(selectedParcel);
            updateHeightHandle();
        }
        document.body.style.cursor = 'ns-resize';
        return;
    }

    // 3. If hovering over the setback handle
    if (setbackHandleMesh) {
        const handleIntersects = raycaster.intersectObject(setbackHandleMesh, true);
        if (handleIntersects.length > 0) {
            document.body.style.cursor = 'ew-resize';
            if (hoveredParcel && hoveredParcel !== selectedParcel) {
                setBuildingHoverHighlight(hoveredParcel.buildingMesh, false);
                hoveredParcel = null;
            }
            return;
        }
    }

    // 4. If hovering over the height handle
    if (heightHandleMesh) {
        const handleIntersects = raycaster.intersectObject(heightHandleMesh, true);
        if (handleIntersects.length > 0) {
            document.body.style.cursor = 'ns-resize';
            if (hoveredParcel && hoveredParcel !== selectedParcel) {
                setBuildingHoverHighlight(hoveredParcel.buildingMesh, false);
                hoveredParcel = null;
            }
            return;
        }
    }

    // 3. Fallback: Hovering over standard parcels / buildings
    const meshes = [];
    parcelFeatures.forEach(item => {
        if (item.parcelMesh) meshes.push(item.parcelMesh);
        if (item.buildingMesh) meshes.push(item.buildingMesh);
    });

    const intersects = raycaster.intersectObjects(meshes);

    if (intersects.length > 0) {
        const hitObject = intersects[0].object;
        const item = getParcelItemFromObject(hitObject);
        
        if (item) {
            document.body.style.cursor = 'pointer';
            if (hoveredParcel !== item) {
                // Un-highlight previous hover
                if (hoveredParcel && hoveredParcel !== selectedParcel) {
                    setBuildingHoverHighlight(hoveredParcel.buildingMesh, false);
                }
                // Apply hover highlight
                hoveredParcel = item;
                if (hoveredParcel !== selectedParcel) {
                    setBuildingHoverHighlight(hoveredParcel.buildingMesh, true);
                }
            }
        } else {
            document.body.style.cursor = 'default';
        }
    } else {
        document.body.style.cursor = 'default';
        if (hoveredParcel) {
            if (hoveredParcel !== selectedParcel) {
                setBuildingHoverHighlight(hoveredParcel.buildingMesh, false);
            }
            hoveredParcel = null;
        }
    }
}

function setBuildingHoverHighlight(meshOrGroup, isHovered) {
    if (!meshOrGroup) return;
    meshOrGroup.traverse(child => {
        if (child.isMesh && Array.isArray(child.material)) {
            const wallMat = child.material[1];
            if (wallMat) {
                if (isHovered) {
                    wallMat.emissive.setHex(0x555555); // subtle glow highlight on hover
                    wallMat.emissiveIntensity = 0.8;
                } else {
                    const tVal = parseFloat(inTime.value);
                    const isNight = tVal < 7.5 || tVal > 19.5;
                    wallMat.emissive.setHex(0xffffff); // default emissive color
                    wallMat.emissiveIntensity = isNight ? 1.0 : 0.0;
                }
            }
        }
    });
}

function toggleTimeAnimation() {
    isTimeAnimating = !isTimeAnimating;
    if (isTimeAnimating) {
        btnPlayTime.textContent = "⏸"; // Pause icon
        btnPlayTime.title = "Pause Shadow Animation";
        btnPlayTime.classList.add('playing');
        animateTime();
    } else {
        btnPlayTime.textContent = "▶"; // Play icon
        btnPlayTime.title = "Animate Solar Shadows";
        btnPlayTime.classList.remove('playing');
        if (timeAnimationId) {
            cancelAnimationFrame(timeAnimationId);
            timeAnimationId = null;
        }
    }
}

function animateTime() {
    if (!isTimeAnimating) return;

    let tVal = parseFloat(inTime.value);
    tVal += 0.05; // speed of shadow animation
    if (tVal > 22.0) {
        tVal = 6.0; // loop back to morning
    }
    
    inTime.value = tVal.toFixed(2);
    
    const hours = Math.floor(tVal);
    const mins = Math.floor((tVal % 1) * 60).toString().padStart(2, '0');
    lblTime.textContent = `${hours}:${mins}`;
    updateSolarPhysics(tVal);

    timeAnimationId = requestAnimationFrame(animateTime);
}

// Spawn 3D vertical arrow drag handle on top of the selected building
function spawnHeightHandle(cx, cy, height) {
    removeHeightHandle();

    // Create an arrow shape pointing up (Teal cylinder + cone)
    const handleGroup = new THREE.Group();

    // Cylinder shaft
    const shaftGeom = new THREE.CylinderGeometry(0.18, 0.22, 2.2, 8);
    const mat = new THREE.MeshStandardMaterial({
        color: 0x0ea5e9, // bright light-blue/teal
        roughness: 0.3,
        metalness: 0.8,
        emissive: 0x0284c7,
        emissiveIntensity: 0.3
    });
    const shaft = new THREE.Mesh(shaftGeom, mat);
    shaft.position.y = 1.1;
    shaft.castShadow = true;
    handleGroup.add(shaft);

    // Cone tip
    const coneGeom = new THREE.ConeGeometry(0.45, 1.0, 8);
    const cone = new THREE.Mesh(coneGeom, mat);
    cone.position.y = 2.7;
    cone.castShadow = true;
    handleGroup.add(cone);

    handleGroup.position.set(cx, height + 0.5, -cy);
    handleGroup.userData = { isHeightHandle: true };

    scene.add(handleGroup);
    heightHandleMesh = handleGroup;
}

// Update height handle position matching building top
function updateHeightHandle() {
    if (!selectedParcel || !heightHandleMesh) return;
    
    // Calculate center of selected parcel
    let cx = 0, cy = 0;
    const ring = selectedParcel.outerRing;
    ring.forEach(pt => { cx += pt.x; cy += pt.y; });
    cx /= ring.length;
    cy /= ring.length;

    const floors = selectedParcel.params.floors;
    const floorH = selectedParcel.params.floorHeight;
    const height = floors * floorH;

    heightHandleMesh.position.set(cx, height + 0.5, -cy);
}

// Remove height handle and clean WebGL resources
function removeHeightHandle() {
    if (heightHandleMesh) {
        scene.remove(heightHandleMesh);
        heightHandleMesh.traverse(child => {
            if (child.isMesh) {
                child.geometry.dispose();
                child.material.dispose();
            }
        });
        heightHandleMesh = null;
    }
}

// Pointer down event handler to detect starting of height or setback dragging
function onPointerDown(event) {
    if (event.target.closest('#control-dock') || event.target.closest('.hud-bar') || event.target.closest('.loading-screen')) return;

    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    if (setbackHandleMesh) {
        const handleIntersects = raycaster.intersectObject(setbackHandleMesh, true);
        if (handleIntersects.length > 0) {
            isDraggingSetback = true;
            controls.enabled = false; // Disable camera rotation
            
            // drag plane is the horizontal ground plane at y = 0.1
            dragIntersectionPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.1);
            return;
        }
    }

    if (heightHandleMesh) {
        const handleIntersects = raycaster.intersectObject(heightHandleMesh, true);
        if (handleIntersects.length > 0) {
            isDraggingHeight = true;
            controls.enabled = false; // Disable camera rotation

            // Create a virtual vertical plane facing the camera, aligned with handle
            const normal = new THREE.Vector3();
            camera.getWorldDirection(normal);
            normal.y = 0;
            normal.normalize();
            
            dragIntersectionPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, heightHandleMesh.position);

            const intersectPoint = new THREE.Vector3();
            raycaster.ray.intersectPlane(dragIntersectionPlane, intersectPoint);
            
            dragStartHeight = intersectPoint.y;
            dragStartFloors = selectedParcel.params.floors;
        }
    }
}

// Pointer up event handler to release dragging
function onPointerUp(event) {
    if (isDraggingHeight) {
        isDraggingHeight = false;
        controls.enabled = true; // Re-enable camera rotation
    }
    if (isDraggingSetback) {
        isDraggingSetback = false;
        controls.enabled = true; // Re-enable camera rotation
    }
}

// Spawn 3D horizontal dragging handle for setback adjustments
function spawnSetbackHandle(mx, my) {
    removeSetbackHandle();

    const handleGroup = new THREE.Group();

    // Torus ring flat on ground
    const torusGeom = new THREE.TorusGeometry(1.2, 0.22, 8, 24);
    torusGeom.rotateX(Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
        color: 0x14b8a6,
        emissive: 0x14b8a6,
        emissiveIntensity: 0.6,
        roughness: 0.2,
        metalness: 0.8
    });
    const torus = new THREE.Mesh(torusGeom, mat);
    torus.castShadow = true;
    handleGroup.add(torus);

    // Cylinder pin
    const pinGeom = new THREE.CylinderGeometry(0.08, 0.08, 0.8, 8);
    const pin = new THREE.Mesh(pinGeom, mat);
    pin.position.y = 0.4;
    pin.castShadow = true;
    handleGroup.add(pin);

    // Sphere cap
    const capGeom = new THREE.SphereGeometry(0.22, 8, 8);
    const cap = new THREE.Mesh(capGeom, mat);
    cap.position.y = 0.8;
    cap.castShadow = true;
    handleGroup.add(cap);

    handleGroup.position.set(mx, 0.1, -my);
    handleGroup.userData = { isSetbackHandle: true };

    scene.add(handleGroup);
    setbackHandleMesh = handleGroup;
}

// Update setback handle position based on updated footprint coordinates
function updateSetbackHandle() {
    if (!selectedParcel || !setbackHandleMesh) return;

    const setback = selectedParcel.params.setback;
    const insetRing = offsetPolygonRing(selectedParcel.outerRing, setback);
    if (!insetRing || insetRing.length < 2) {
        removeSetbackHandle();
        return;
    }

    // Place handle on first segment midpoint
    const pt1 = insetRing[0];
    const pt2 = insetRing[1];
    const mx = (pt1.x + pt2.x) / 2;
    const my = (pt1.y + pt2.y) / 2;

    setbackHandleMesh.position.set(mx, 0.1, -my);
}

// Remove setback handle and clean WebGL resources
function removeSetbackHandle() {
    if (setbackHandleMesh) {
        scene.remove(setbackHandleMesh);
        setbackHandleMesh.traverse(child => {
            if (child.isMesh) {
                child.geometry.dispose();
                child.material.dispose();
            }
        });
        setbackHandleMesh = null;
    }
}

// Helper to get minimum distance from point to polygon boundary
function getDistanceToPolygon(pt, ring) {
    let minDist = Infinity;
    const N = ring.length;
    for (let i = 0; i < N; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % N];
        const dist = distToSegment(pt, a, b);
        if (dist < minDist) {
            minDist = dist;
        }
    }
    return minDist;
}

// ───────────────────────── 3D Ruler / Measurement Tool ─────────────────────────

// Initialize the temporary measurement line and HTML label marker
function initTemporaryMeasurementAssets() {
    if (!tempMeasureLine) {
        const lineGeom = new THREE.BufferGeometry();
        const positions = new Float32Array(6); // 2 points * 3 coordinates
        lineGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const lineMat = new THREE.LineDashedMaterial({
            color: 0x38bdf8, // light blue/sky
            dashSize: 2,
            gapSize: 1,
            depthTest: false,
            transparent: true,
            opacity: 0.8
        });
        tempMeasureLine = new THREE.Line(lineGeom, lineMat);
        tempMeasureLine.visible = false;
        tempMeasureLine.userData = { isMeasurementElement: true };
        scene.add(tempMeasureLine);
    }

    if (!tempMeasureLabel) {
        const container = document.getElementById('measurement-overlay-container');
        if (container) {
            tempMeasureLabel = document.createElement('div');
            tempMeasureLabel.id = 'temp-measure-label';
            tempMeasureLabel.className = 'measurement-label temp';
            tempMeasureLabel.style.display = 'none';
            container.appendChild(tempMeasureLabel);
        }
    }
}

// Handle clicks in 3D scene when measurement tool is active
function handleMeasurementClick(pt) {
    initTemporaryMeasurementAssets();

    // Create marker at click position
    const markerGeom = new THREE.SphereGeometry(0.4, 16, 16);
    const markerMat = new THREE.MeshBasicMaterial({ color: 0x10b981, depthTest: false });
    const marker = new THREE.Mesh(markerGeom, markerMat);
    marker.position.copy(pt);
    marker.userData = { isMeasurementElement: true };
    scene.add(marker);

    if (measurementPoints.length === 0) {
        measurementPoints.push(pt);
        // Save the start marker
        savedMeasurements.push({ type: 'marker', mesh: marker });
    } else {
        const startPt = measurementPoints[0];
        const endPt = pt;
        
        // Permanent line
        const borderPoints = [startPt.clone(), endPt.clone()];
        const lineGeom = new THREE.BufferGeometry().setFromPoints(borderPoints);
        const lineMat = new THREE.LineBasicMaterial({
            color: 0x10b981, // neon emerald green
            linewidth: 2,
            depthTest: false
        });
        const line = new THREE.Line(lineGeom, lineMat);
        line.userData = { isMeasurementElement: true };
        scene.add(line);

        // Permanent Label
        const midpoint = new THREE.Vector3().addVectors(startPt, endPt).multiplyScalar(0.5);
        const container = document.getElementById('measurement-overlay-container');
        let labelEl = null;
        if (container) {
            labelEl = document.createElement('div');
            labelEl.className = 'measurement-label';
            const distance = startPt.distanceTo(endPt);
            labelEl.textContent = `${distance.toFixed(2)} m`;
            container.appendChild(labelEl);
        }

        // Save the permanent measurement assets
        savedMeasurements.push({
            type: 'measurement',
            line: line,
            markerStart: savedMeasurements.pop().mesh, // start marker mesh
            markerEnd: marker,
            labelEl: labelEl,
            midpoint: midpoint
        });

        // Show clear button
        if (btnClearMeasure) {
            btnClearMeasure.classList.remove('hidden');
        }

        // Reset for next measurement
        measurementPoints = [];
        if (tempMeasureLine) tempMeasureLine.visible = false;
        if (tempMeasureLabel) tempMeasureLabel.style.display = 'none';
    }
}

// Clear all measurements from scene and DOM
function clearAllMeasurements() {
    savedMeasurements.forEach(m => {
        if (m.type === 'marker' && m.mesh) {
            scene.remove(m.mesh);
            m.mesh.geometry.dispose();
            m.mesh.material.dispose();
        } else if (m.type === 'measurement') {
            if (m.line) {
                scene.remove(m.line);
                m.line.geometry.dispose();
                m.line.material.dispose();
            }
            if (m.markerStart) {
                scene.remove(m.markerStart);
                m.markerStart.geometry.dispose();
                m.markerStart.material.dispose();
            }
            if (m.markerEnd) {
                scene.remove(m.markerEnd);
                m.markerEnd.geometry.dispose();
                m.markerEnd.material.dispose();
            }
            if (m.labelEl) {
                m.labelEl.remove();
            }
        }
    });

    savedMeasurements = [];
    measurementPoints = [];
    if (tempMeasureLine) tempMeasureLine.visible = false;
    if (tempMeasureLabel) tempMeasureLabel.style.display = 'none';

    if (btnClearMeasure) {
        btnClearMeasure.classList.add('hidden');
    }
}

// Recalculate label coordinates on screen space
function updateMeasurementLabels() {
    const container = document.getElementById('measurement-overlay-container');
    if (!container) return;

    // 1. Update active temporary label
    if (tempMeasureLabel && tempMeasureLine && measurementPoints.length === 1) {
        // Find current intersection point under cursor
        const intersects = raycaster.intersectObjects(scene.children, true);
        const filtered = intersects.filter(hit => {
            return hit.object.type === 'Mesh' && 
                   !hit.object.userData?.isHeightHandle && 
                   !hit.object.userData?.isSetbackHandle && 
                   !hit.object.userData?.isMeasurementElement;
        });

        if (filtered.length > 0) {
            const hitPoint = filtered[0].point;
            const start = measurementPoints[0];
            const midpoint = new THREE.Vector3().addVectors(start, hitPoint).multiplyScalar(0.5);
            const screenPos = project3DToScreen(midpoint);
            tempMeasureLabel.style.left = `${screenPos.x}px`;
            tempMeasureLabel.style.top = `${screenPos.y}px`;
            
            const distance = start.distanceTo(hitPoint);
            tempMeasureLabel.textContent = `${distance.toFixed(2)} m`;
        }
    }

    // 2. Update all saved permanent labels
    savedMeasurements.forEach(m => {
        if (m.type === 'measurement' && m.labelEl) {
            const screenPos = project3DToScreen(m.midpoint);
            m.labelEl.style.left = `${screenPos.x}px`;
            m.labelEl.style.top = `${screenPos.y}px`;
        }
    });
}

// Project 3D vector coordinates to screen pixel positions
function project3DToScreen(vec3) {
    const tempV = vec3.clone();
    tempV.project(camera);

    const x = (tempV.x * 0.5 + 0.5) * window.innerWidth;
    const y = (tempV.y * -0.5 + 0.5) * window.innerHeight;

    return { x, y };
}

// ───────────────────────── Procedural City Solver & Optimization ─────────────────────────

// Auto-solve zoning constraints (TAKS/KAKS) for a specific parcel feature
function optimizeParcelZoning(item) {
    if (item.params.usage === 'Park') {
        item.params.floors = 0;
        item.params.setback = 3.0;
        item.params.typology = 'Tower';
        item.modified = true;
        return;
    }

    const maxBcr = item.params.maxBcr;
    const maxFar = item.params.maxFar;
    const maxHeight = item.params.maxHeight;
    const floorHeight = item.params.floorHeight || 3.0;

    // 1. Choose suitable building typology based on parcel area and aspect ratio
    const ob = getOrientedBounds(item.outerRing);
    const aspect = ob.W > 0 ? (ob.H / ob.W) : 1;
    let selectedTypology = 'Tower';

    if (item.area > 1500) {
        // Large parcels: MultiBuildingBlock, Courtyard, PodiumTower, or SteppedTower
        const r = Math.random();
        if (r < 0.40) selectedTypology = 'MultiBuildingBlock';
        else if (r < 0.60) selectedTypology = 'Courtyard';
        else if (r < 0.80) selectedTypology = 'PodiumTower';
        else selectedTypology = 'SteppedTower';
    } else if (item.area > 800) {
        // Medium parcels: Slab/Row, L-Shape, or U-Shape
        if (aspect > 1.7 || aspect < 0.6) {
            selectedTypology = 'Slab';
        } else {
            const r = Math.random();
            selectedTypology = r < 0.5 ? 'LShape' : 'UShape';
        }
    } else {
        // Small parcels: Tower
        selectedTypology = 'Tower';
    }

    item.params.typology = selectedTypology;

    // 2. Search for the optimal setback distance that satisfies the Max BCR limit (TAKS)
    let bestSetback = 3.0;
    let bestFootprint = 0;
    let bcrCompliantFound = false;

    // Search from 8.0m down to 2.0m (we want the smallest setback that doesn't violate TAKS)
    for (let sb = 8.0; sb >= 2.0; sb -= 0.5) {
        const insetRing = offsetPolygonRing(item.outerRing, sb);
        if (!insetRing || insetRing.length < 3) continue;

        let footprintArea = 0;
        if (selectedTypology === 'Courtyard') {
            const innerSetback = 8;
            const innerRing = offsetPolygonRing(insetRing, innerSetback);
            const outerArea = calculatePolygonArea(insetRing);
            const innerArea = innerRing ? calculatePolygonArea(innerRing) : 0;
            footprintArea = Math.max(0, outerArea - innerArea);
        } else if (selectedTypology === 'Slab') {
            footprintArea = calculateShapeArea(buildSlabShape(insetRing, 12));
        } else if (selectedTypology === 'LShape') {
            footprintArea = calculateShapeArea(buildLShape(insetRing, 12));
        } else if (selectedTypology === 'UShape') {
            footprintArea = calculateShapeArea(buildUShape(insetRing, 12));
        } else if (selectedTypology === 'PodiumTower') {
            footprintArea = calculatePolygonArea(insetRing);
        } else if (selectedTypology === 'SteppedTower') {
            footprintArea = calculatePolygonArea(insetRing);
        } else if (selectedTypology === 'MultiBuildingBlock') {
            const obInset = getOrientedBounds(insetRing);
            const W = obInset.W;
            const localRing = insetRing.map(pt => {
                const rx = pt.x - obInset.cx;
                const ry = pt.y - obInset.cy;
                return {
                    x: rx * obInset.ux + ry * obInset.uy,
                    y: rx * obInset.nx + ry * obInset.ny
                };
            });
            let footArea = 0;
            if (W >= 40) {
                const localPoly1 = clipConvexPolygonVertical(localRing, obInset.minX, obInset.minX + W * 0.38);
                const localPoly3 = clipConvexPolygonVertical(localRing, obInset.minX + W * 0.62, obInset.maxX);
                let insetPoly1 = null;
                let insetPoly3 = null;
                if (localPoly1 && localPoly1.length >= 3) {
                    const globalPoly1 = localPoly1.map(pt => ({
                        x: obInset.cx + pt.x * obInset.ux + pt.y * obInset.nx,
                        y: obInset.cy + pt.x * obInset.uy + pt.y * obInset.ny
                    }));
                    insetPoly1 = offsetPolygonRing(globalPoly1, 1.2);
                }
                if (localPoly3 && localPoly3.length >= 3) {
                    const globalPoly3 = localPoly3.map(pt => ({
                        x: obInset.cx + pt.x * obInset.ux + pt.y * obInset.nx,
                        y: obInset.cy + pt.x * obInset.uy + pt.y * obInset.ny
                    }));
                    insetPoly3 = offsetPolygonRing(globalPoly3, 1.2);
                }
                if (insetPoly1 && insetPoly1.length >= 3) footArea += calculatePolygonArea(insetPoly1);
                if (insetPoly3 && insetPoly3.length >= 3) footArea += calculatePolygonArea(insetPoly3);
            } else {
                const localPoly1 = clipConvexPolygonVertical(localRing, obInset.minX, obInset.minX + W * 0.5);
                let insetPoly1 = null;
                if (localPoly1 && localPoly1.length >= 3) {
                    const globalPoly1 = localPoly1.map(pt => ({
                        x: obInset.cx + pt.x * obInset.ux + pt.y * obInset.nx,
                        y: obInset.cy + pt.x * obInset.uy + pt.y * obInset.ny
                    }));
                    insetPoly1 = offsetPolygonRing(globalPoly1, 1.2);
                }
                if (insetPoly1 && insetPoly1.length >= 3) footArea += calculatePolygonArea(insetPoly1);
            }
            footprintArea = footArea;
        } else { // Tower
            footprintArea = calculatePolygonArea(insetRing);
        }

        const bcr = item.area > 0 ? (footprintArea / item.area) : 0;
        if (bcr <= maxBcr) {
            bestSetback = sb;
            bestFootprint = footprintArea;
            bcrCompliantFound = true;
            break; // found the optimal setback maximizing footprint within constraints
        }
    }

    // Fallback if no compliant setback is found
    if (!bcrCompliantFound) {
        bestSetback = 4.0;
        const insetRing = offsetPolygonRing(item.outerRing, bestSetback);
        if (insetRing && insetRing.length >= 3) {
            bestFootprint = calculatePolygonArea(insetRing) * 0.5;
        }
    }

    item.params.setback = bestSetback;

    // 3. Optimize Floor Count (Maximize GFA up to KAKS and Height limits)
    let maxFloorsHeight = Math.floor(maxHeight / floorHeight);
    let maxFloorsFar = bestFootprint > 0 ? Math.floor((maxFar * item.area) / bestFootprint) : 1;

    // Refined solver for stacked typologies
    if (selectedTypology === 'PodiumTower') {
        const towerRing = offsetPolygonRing(offsetPolygonRing(item.outerRing, bestSetback), 3.5);
        const towerArea = towerRing ? calculatePolygonArea(towerRing) : bestFootprint * 0.6;
        const podiumArea = bestFootprint;
        const maxGfa = maxFar * item.area;
        const remainingGfa = maxGfa - podiumArea * 2;
        if (remainingGfa > 0 && towerArea > 0) {
            maxFloorsFar = 2 + Math.floor(remainingGfa / towerArea);
        } else {
            maxFloorsFar = Math.floor(maxGfa / podiumArea);
        }
    } else if (selectedTypology === 'SteppedTower') {
        const stepInterval = item.params.stepbackInterval || 4;
        const stepDepth = item.params.stepbackDepth || 1.5;
        let testFloors = 1;
        while (testFloors <= 30) {
            let remainingFloors = testFloors;
            let segmentIndex = 0;
            let testGfa = 0;
            while (remainingFloors > 0) {
                const currentSetback = bestSetback + segmentIndex * stepDepth;
                const segmentRing = offsetPolygonRing(item.outerRing, currentSetback);
                if (!segmentRing || segmentRing.length < 3) break;
                const segFloors = Math.min(stepInterval, remainingFloors);
                const segArea = calculatePolygonArea(segmentRing);
                testGfa += segArea * segFloors;
                remainingFloors -= segFloors;
                segmentIndex++;
            }
            if (testGfa / item.area > maxFar || testFloors * floorHeight > maxHeight) {
                testFloors--;
                break;
            }
            testFloors++;
        }
        maxFloorsFar = Math.max(1, testFloors);
    } else if (selectedTypology === 'MultiBuildingBlock') {
        const insetRing = offsetPolygonRing(item.outerRing, bestSetback);
        if (insetRing && insetRing.length >= 3) {
            const obInset = getOrientedBounds(insetRing);
            const W = obInset.W;
            const localRing = insetRing.map(pt => {
                const rx = pt.x - obInset.cx;
                const ry = pt.y - obInset.cy;
                return {
                    x: rx * obInset.ux + ry * obInset.uy,
                    y: rx * obInset.nx + ry * obInset.ny
                };
            });
            let footArea1 = 0;
            let footArea3 = 0;
            if (W >= 40) {
                const localPoly1 = clipConvexPolygonVertical(localRing, obInset.minX, obInset.minX + W * 0.38);
                const localPoly3 = clipConvexPolygonVertical(localRing, obInset.minX + W * 0.62, obInset.maxX);
                let insetPoly1 = null;
                let insetPoly3 = null;
                if (localPoly1 && localPoly1.length >= 3) {
                    const globalPoly1 = localPoly1.map(pt => ({
                        x: obInset.cx + pt.x * obInset.ux + pt.y * obInset.nx,
                        y: obInset.cy + pt.x * obInset.uy + pt.y * obInset.ny
                    }));
                    insetPoly1 = offsetPolygonRing(globalPoly1, 1.2);
                }
                if (localPoly3 && localPoly3.length >= 3) {
                    const globalPoly3 = localPoly3.map(pt => ({
                        x: obInset.cx + pt.x * obInset.ux + pt.y * obInset.nx,
                        y: obInset.cy + pt.x * obInset.uy + pt.y * obInset.ny
                    }));
                    insetPoly3 = offsetPolygonRing(globalPoly3, 1.2);
                }
                if (insetPoly1 && insetPoly1.length >= 3) footArea1 = calculatePolygonArea(insetPoly1);
                if (insetPoly3 && insetPoly3.length >= 3) footArea3 = calculatePolygonArea(insetPoly3);
            } else {
                const localPoly1 = clipConvexPolygonVertical(localRing, obInset.minX, obInset.minX + W * 0.5);
                let insetPoly1 = null;
                if (localPoly1 && localPoly1.length >= 3) {
                    const globalPoly1 = localPoly1.map(pt => ({
                        x: obInset.cx + pt.x * obInset.ux + pt.y * obInset.nx,
                        y: obInset.cy + pt.x * obInset.uy + pt.y * obInset.ny
                    }));
                    insetPoly1 = offsetPolygonRing(globalPoly1, 1.2);
                }
                if (insetPoly1 && insetPoly1.length >= 3) footArea1 = calculatePolygonArea(insetPoly1);
            }
            let testFloors = 1;
            while (testFloors <= 30) {
                const floorsA = Math.round(testFloors * 1.3);
                const floorsB = Math.round(testFloors * 0.7);
                const testGfa = footArea1 * floorsA + footArea3 * floorsB;
                const tallestHeight = Math.max(floorsA, floorsB) * floorHeight;
                if (testGfa / item.area > maxFar || tallestHeight > maxHeight) {
                    testFloors--;
                    break;
                }
                testFloors++;
            }
            maxFloorsFar = Math.max(1, testFloors);
        } else {
            maxFloorsFar = 1;
        }
    }

    let optimalFloors = Math.min(maxFloorsHeight, maxFloorsFar);
    optimalFloors = Math.max(1, Math.min(30, optimalFloors));

    item.params.floors = optimalFloors;
    item.modified = true;
}

// Automatically solve and optimize zoning constraints for all parcels in the city
function solveCityLayout() {
    if (!parcelFeatures || parcelFeatures.length === 0) {
        alert("No parcels loaded to solve.");
        return;
    }

    parcelFeatures.forEach(item => {
        optimizeParcelZoning(item);
        rebuildParcel3D(item);
    });

    if (selectedParcel) {
        selectParcel(selectedParcel);
        updateDashboard(selectedParcel);
    }

    alert(`Procedural solver successfully optimized layout constraints for all ${parcelFeatures.length} parcels in the city!`);
}

// ───────────────────────── Procedural Landscaping & Facade Assets ─────────────────────────

// Generate a grass garden lawn in the setback zone
function buildSetbackLawn(item, insetRing) {
    if (item.params.usage === 'Park') return null;

    const lawnShape = new THREE.Shape();
    item.outerRing.forEach((pt, i) => {
        if (i === 0) lawnShape.moveTo(pt.x, pt.y);
        else lawnShape.lineTo(pt.x, pt.y);
    });

    if (insetRing && insetRing.length >= 3) {
        const hole = new THREE.Path();
        insetRing.forEach((pt, i) => {
            if (i === 0) hole.moveTo(pt.x, pt.y);
            else hole.lineTo(pt.x, pt.y);
        });
        lawnShape.holes.push(hole);
    }

    const lawnGeom = new THREE.ExtrudeGeometry(lawnShape, { depth: 0.08, bevelEnabled: false });
    lawnGeom.rotateX(-Math.PI / 2);
    lawnGeom.translate(0, 0.04, 0); // slightly elevated above street level

    const lawnMat = new THREE.MeshStandardMaterial({ color: 0x166534, roughness: 0.95 });
    const lawnMesh = new THREE.Mesh(lawnGeom, lawnMat);
    lawnMesh.receiveShadow = true;
    return lawnMesh;
}

// Construct a streetlight lamppost with a spotlight source
function buildStreetlight(x, y, z) {
    const group = new THREE.Group();
    group.position.set(x, y, z);

    // Pole
    const poleGeom = new THREE.CylinderGeometry(0.1, 0.15, 5, 8);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.8, roughness: 0.3 });
    const pole = new THREE.Mesh(poleGeom, poleMat);
    pole.position.y = 2.5;
    pole.castShadow = true;
    group.add(pole);

    // Arm
    const armGeom = new THREE.BoxGeometry(0.15, 0.15, 1.2);
    const arm = new THREE.Mesh(armGeom, poleMat);
    arm.position.set(0, 5.0, 0.5);
    arm.rotation.x = 0.1;
    arm.castShadow = true;
    group.add(arm);

    // Lamp bulb
    const bulbGeom = new THREE.SphereGeometry(0.2, 8, 8);
    const tVal = parseFloat(inTime.value);
    const isNight = tVal < 7.5 || tVal > 19.5;
    const bulbMat = new THREE.MeshBasicMaterial({ 
        color: 0xfef08a,
        transparent: true,
        opacity: isNight ? 1.0 : 0.2
    });
    const bulb = new THREE.Mesh(bulbGeom, bulbMat);
    bulb.position.set(0, 4.9, 1.1);
    bulb.userData = { isStreetlightBulb: true };
    group.add(bulb);

    // Light source pointing downwards
    const spotlight = new THREE.SpotLight(0xfef08a, isNight ? 3.0 : 0.0, 15, Math.PI / 4, 0.5, 1);
    spotlight.position.set(0, 4.8, 1.1);
    spotlight.target.position.set(0, 0, 1.1);
    group.add(spotlight);
    group.add(spotlight.target);

    return group;
}

// Generate street trees and lamp posts along outer parcel boundary segments
function addSidewalkTreesAndAssets(group, item, insetRing) {
    if (item.params.usage === 'Park') return;

    // Calculate centroid of parcel to determine inward direction
    let cx = 0, cy = 0;
    item.outerRing.forEach(pt => { cx += pt.x; cy += pt.y; });
    cx /= item.outerRing.length;
    cy /= item.outerRing.length;

    const ring = item.outerRing;
    const len = ring.length;
    for (let i = 0; i < len; i++) {
        const p1 = ring[i];
        const p2 = ring[(i + 1) % len];

        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Place streetlights at corners
        if (i % 2 === 0) {
            const streetLamp = buildStreetlight(p1.x, 0.08, -p1.y);
            group.add(streetLamp);
        }

        // Place street trees on boundary segments longer than 12m
        if (dist > 12) {
            const numTrees = Math.floor(dist / 10);
            for (let j = 1; j <= numTrees; j++) {
                const t = j / (numTrees + 1);
                const bx = p1.x + dx * t;
                const by = p1.y + dy * t;

                // Inward normal pointing towards parcel center
                const nx = cx - bx;
                const ny = cy - by;
                const nLen = Math.sqrt(nx * nx + ny * ny);
                if (nLen > 0) {
                    // Offset inward by 1.8m so it sits inside the setback lawn
                    const offsetDistance = 1.8;
                    const tx = bx + (nx / nLen) * offsetDistance;
                    const ty = by + (ny / nLen) * offsetDistance;

                    const treeHeight = 3.5 + Math.random() * 2.5;
                    const styles = ['deciduous', 'spherical', 'conifer'];
                    const style = styles[Math.floor(Math.random() * styles.length)];
                    const tree = buildLowPolyTree(tx, 0.08, -ty, treeHeight, style);
                    group.add(tree);
                }
            }
        }
    }
}

// Procedurally extrude concrete balconies and railings on building facades
function addBuildingBalconies(group, insetRing, floors, floorHeight) {
    if (floors <= 1) return;

    const len = insetRing.length;
    for (let i = 0; i < len; i++) {
        // Place balconies on alternate facades for architectural rhythm
        if (i % 2 !== 0) continue;

        const p1 = insetRing[i];
        const p2 = insetRing[(i + 1) % len];

        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Build balconies on wide facades
        if (dist > 12) {
            const mx = (p1.x + p2.x) / 2;
            const my = (p1.y + p2.y) / 2;

            // Outward normal vector
            let nx = dy;
            let ny = -dx;
            const nLen = Math.sqrt(nx * nx + ny * ny);
            if (nLen > 0) {
                nx /= nLen;
                ny /= nLen;

                const angle = Math.atan2(dy, dx);

                // Add balconies for each upper floor
                for (let f = 1; f < floors; f++) {
                    const bh = f * floorHeight;

                    const balcony = new THREE.Group();
                    balcony.position.set(mx + nx * 0.5, bh, -(my + ny * 0.5));
                    balcony.rotation.y = angle;

                    // Slab
                    const slabWidth = dist * 0.4;
                    const slabGeom = new THREE.BoxGeometry(slabWidth, 0.12, 1.2);
                    const slabMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.5 });
                    const slab = new THREE.Mesh(slabGeom, slabMat);
                    slab.position.set(0, -0.06, 0.6);
                    slab.castShadow = true;
                    slab.receiveShadow = true;
                    balcony.add(slab);

                    // Glass railing
                    const railGeom = new THREE.BoxGeometry(slabWidth, 1.0, 0.05);
                    const railMat = new THREE.MeshStandardMaterial({ 
                        color: 0x38bdf8, 
                        transparent: true, 
                        opacity: 0.4,
                        roughness: 0.1,
                        metalness: 0.9
                    });
                    const rail = new THREE.Mesh(railGeom, railMat);
                    rail.position.set(0, 0.5, 1.2);
                    rail.castShadow = true;
                    balcony.add(rail);

                    // Glass railing sides
                    const sideRailGeom = new THREE.BoxGeometry(0.05, 1.0, 1.2);
                    for (let side = -1; side <= 1; side += 2) {
                        const sideRail = new THREE.Mesh(sideRailGeom, railMat);
                        sideRail.position.set(side * (slabWidth / 2), 0.5, 0.6);
                        sideRail.castShadow = true;
                        balcony.add(sideRail);
                    }

                    group.add(balcony);
                }
            }
        }
    }
}

// Clip convex polygon with vertical lines in 2D local space
function clipConvexPolygonVertical(localRing, X_start, X_end) {
    const N = localRing.length;
    const allPts = [];

    // 1. Get intersections at X_start
    const y_start_intersects = [];
    for (let i = 0; i < N; i++) {
        const p1 = localRing[i];
        const p2 = localRing[(i + 1) % N];
        if ((p1.x <= X_start && X_start <= p2.x) || (p2.x <= X_start && X_start <= p1.x)) {
            if (Math.abs(p2.x - p1.x) > 0.0001) {
                const t = (X_start - p1.x) / (p2.x - p1.x);
                const y = p1.y + t * (p2.y - p1.y);
                y_start_intersects.push(y);
            }
        }
    }
    y_start_intersects.sort((a, b) => a - b);
    if (y_start_intersects.length >= 2) {
        allPts.push({ x: X_start, y: y_start_intersects[0] });
        allPts.push({ x: X_start, y: y_start_intersects[y_start_intersects.length - 1] });
    }

    // 2. Get original vertices that lie between X_start and X_end
    for (let i = 0; i < N; i++) {
        const p = localRing[i];
        if (p.x > X_start && p.x < X_end) {
            allPts.push(p);
        }
    }

    // 3. Get intersections at X_end
    const y_end_intersects = [];
    for (let i = 0; i < N; i++) {
        const p1 = localRing[i];
        const p2 = localRing[(i + 1) % N];
        if ((p1.x <= X_end && X_end <= p2.x) || (p2.x <= X_end && X_end <= p1.x)) {
            if (Math.abs(p2.x - p1.x) > 0.0001) {
                const t = (X_end - p1.x) / (p2.x - p1.x);
                const y = p1.y + t * (p2.y - p1.y);
                y_end_intersects.push(y);
            }
        }
    }
    y_end_intersects.sort((a, b) => a - b);
    if (y_end_intersects.length >= 2) {
        allPts.push({ x: X_end, y: y_end_intersects[y_end_intersects.length - 1] });
        allPts.push({ x: X_end, y: y_end_intersects[0] });
    }

    // Filter duplicates
    const uniquePts = [];
    allPts.forEach(p => {
        if (!uniquePts.some(u => Math.abs(u.x - p.x) < 0.01 && Math.abs(u.y - p.y) < 0.01)) {
            uniquePts.push(p);
        }
    });

    if (uniquePts.length < 3) return null;

    // Sort counter-clockwise around centroid
    let cx = 0, cy = 0;
    uniquePts.forEach(p => { cx += p.x; cy += p.y; });
    cx /= uniquePts.length;
    cy /= uniquePts.length;

    uniquePts.sort((a, b) => {
        return Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx);
    });

    return uniquePts;
}

// Generate a detailed low-poly car group (reused for parked cars and traffic)
function buildDetailedCar(colorHex, scale = 1.0) {
    const carGroup = new THREE.Group();

    // Body base
    const bodyGeom = new THREE.BoxGeometry(2.4 * scale, 0.6 * scale, 1.1 * scale);
    const bodyMat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.5 });
    const body = new THREE.Mesh(bodyGeom, bodyMat);
    body.castShadow = true;
    body.receiveShadow = true;
    body.position.y = 0.3 * scale;
    carGroup.add(body);

    // Cabin
    const cabinGeom = new THREE.BoxGeometry(1.3 * scale, 0.5 * scale, 0.95 * scale);
    const cabinMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.2 });
    const cabin = new THREE.Mesh(cabinGeom, cabinMat);
    cabin.castShadow = true;
    cabin.position.set(-0.15 * scale, 0.8 * scale, 0);
    carGroup.add(cabin);

    // Wheels (4 cylinders)
    const wheelGeom = new THREE.CylinderGeometry(0.24 * scale, 0.24 * scale, 0.2 * scale, 8);
    wheelGeom.rotateX(Math.PI / 2);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.9 });
    
    const wheelOffsets = [
        { x: 0.7, z: 0.55 },
        { x: 0.7, z: -0.55 },
        { x: -0.7, z: 0.55 },
        { x: -0.7, z: -0.55 }
    ];
    
    wheelOffsets.forEach(offset => {
        const wheel = new THREE.Mesh(wheelGeom, wheelMat);
        wheel.position.set(offset.x * scale, 0.12 * scale, offset.z * scale);
        wheel.castShadow = true;
        carGroup.add(wheel);
    });

    // Lights
    const headlightGeom = new THREE.SphereGeometry(0.08 * scale, 8, 8);
    const headlightMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });
    const taillightMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });

    for (let side = -1; side <= 1; side += 2) {
        const hl = new THREE.Mesh(headlightGeom, headlightMat);
        hl.position.set(1.2 * scale, 0.3 * scale, side * 0.45 * scale);
        hl.userData = { isHeadlight: true };
        hl.visible = false;
        carGroup.add(hl);

        const tl = new THREE.Mesh(headlightGeom, taillightMat);
        tl.position.set(-1.2 * scale, 0.3 * scale, side * 0.45 * scale);
        tl.userData = { isTaillight: true };
        tl.visible = false;
        carGroup.add(tl);
    }

    return carGroup;
}

