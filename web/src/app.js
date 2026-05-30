/* app.js - PlanX Urban Procedural 3D */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Application State
let scene, camera, renderer, controls;
let raycaster, mouse;
let parcelFeatures = []; // Array of { fid, properties, outerRing, parcelMesh, buildingMesh, setbackMesh, sidewalkMesh, zoningMesh, area, params }
let selectedParcel = null;

// Projection variables (local offset)
let centerX = 0;
let centerY = 0;

// Setup UI Element references
const loadingEl = document.getElementById('loading');
const placeholderEl = document.getElementById('selection-placeholder');
const controlsEl = document.getElementById('editor-controls');
const btnSync = document.getElementById('btn-sync');

// Input controls
const inTypology = document.getElementById('input-typology');
const inUsage = document.getElementById('input-usage');
const inSetback = document.getElementById('input-setback');
const inFloors = document.getElementById('input-floors');
const inFloorHeight = document.getElementById('input-floorheight');
const inMaxBcr = document.getElementById('input-max-bcr');
const inMaxFar = document.getElementById('input-max-far');
const inMaxHeight = document.getElementById('input-max-height');

// Label values
const lblSetback = document.getElementById('val-setback');
const lblFloors = document.getElementById('val-floors');
const lblFloorHeight = document.getElementById('val-floorheight');
const lblMaxBcr = document.getElementById('val-max-bcr');
const lblMaxFar = document.getElementById('val-max-far');
const lblMaxHeight = document.getElementById('val-max-height');

// Metrics
const metFid = document.getElementById('prop-fid');
const metArea = document.getElementById('prop-area');
const metFootprint = document.getElementById('metric-footprint');
const metGfa = document.getElementById('metric-gfa');
const metHeight = document.getElementById('metric-height');
const metBcrLabel = document.getElementById('metric-bcr-label');
const metFarLabel = document.getElementById('metric-far-label');
const metStatus = document.getElementById('metric-status');

// HUD
const hudTotalParcels = document.getElementById('hud-total-parcels');
const hudCrs = document.getElementById('hud-crs');

// Initialize the 3D scene
function init() {
    // 1. Scene setup
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0e17); // Slate-950 Dark Theme

    // 2. Camera setup
    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 1, 10000);
    camera.position.set(0, 180, 280);

    // 3. Renderer setup
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.getElementById('viewport').appendChild(renderer.domElement);

    // 4. OrbitControls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2 - 0.02; // Prevents camera from going under ground

    // 5. Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.45);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.85);
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

    // Grid Floor
    const grid = new THREE.GridHelper(1200, 120, 0x1e293b, 0x0f172a);
    grid.position.y = -0.05;
    scene.add(grid);

    // 6. Interaction
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();
    window.addEventListener('click', onDocumentClick);
    window.addEventListener('resize', onWindowResize);

    setupInputListeners();

    // 7. Load Data
    loadGeoJSON();

    animate();
}

// Render loop
function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}

// Resize handler
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// Set up UI input controls event handlers
function setupInputListeners() {
    const triggerUpdate = () => {
        if (!selectedParcel) return;
        
        // Read slider values
        selectedParcel.params.setback = parseFloat(inSetback.value);
        selectedParcel.params.floors = parseInt(inFloors.value);
        selectedParcel.params.floorHeight = parseFloat(inFloorHeight.value);
        selectedParcel.params.typology = inTypology.value;
        selectedParcel.params.usage = inUsage.value;
        
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

        // Rebuild meshes
        rebuildParcel3D(selectedParcel);
        updateDashboard(selectedParcel);
    };

    inSetback.addEventListener('input', triggerUpdate);
    inFloors.addEventListener('input', triggerUpdate);
    inFloorHeight.addEventListener('input', triggerUpdate);
    inTypology.addEventListener('change', triggerUpdate);
    inUsage.addEventListener('change', triggerUpdate);
    
    // Zoning inputs
    inMaxBcr.addEventListener('input', triggerUpdate);
    inMaxFar.addEventListener('input', triggerUpdate);
    inMaxHeight.addEventListener('input', triggerUpdate);

    btnSync.addEventListener('click', syncToQGIS);
}

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
        console.error(e);
        document.getElementById('loading-text').innerText = "ERROR: Failed to load layer. Verify QGIS server connection.";
    }
}

// Parse GeoJSON geometries and center coordinates
function parseGeoJSON(data) {
    if (!data.features || data.features.length === 0) return;

    hudTotalParcels.textContent = data.features.length;
    if (data.crs && data.crs.properties && data.crs.properties.name) {
        const crsName = data.crs.properties.name.split("::").pop();
        hudCrs.textContent = crsName;
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

    // Zoom camera to fit parcels bounds
    const maxDim = Math.max(maxX - minX, maxY - minY);
    camera.position.set(0, maxDim * 0.8, maxDim * 1.2);
    controls.target.set(0, 0, 0);
    controls.update();
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
        color: 0x1e293b, // slate-800
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

// Build concrete sidewalk mesh around the parcel
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
        color: 0x52525b, // slate-600 concrete
        roughness: 0.8
    });

    const mesh = new THREE.Mesh(geom, mat);
    mesh.receiveShadow = true;
    mesh.position.y = -0.05;
    scene.add(mesh);
    item.sidewalkMesh = mesh;
}

// Rebuild building massing, zoning envelopes, and setback lines based on params
function rebuildParcel3D(item) {
    // 1. Clear old models
    if (item.buildingMesh) {
        scene.remove(item.buildingMesh);
        item.buildingMesh.geometry.dispose();
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

    // Calculate footprint area
    let footprintArea = 0;
    const envShape = new THREE.Shape();
    insetRing.forEach((pt, i) => {
        if (i === 0) envShape.moveTo(pt.x, pt.y);
        else envShape.lineTo(pt.x, pt.y);
    });

    if (typology === 'Courtyard') {
        const innerSetback = 8;
        const innerRing = offsetPolygonRing(insetRing, innerSetback);
        const outerArea = calculatePolygonArea(insetRing);
        const innerArea = innerRing ? calculatePolygonArea(innerRing) : 0;
        footprintArea = Math.max(0, outerArea - innerArea);
    } else if (typology === 'Slab') {
        const slabShape = buildSlabShape(insetRing, 12);
        footprintArea = calculateShapeArea(slabShape);
    } else {
        footprintArea = calculatePolygonArea(insetRing);
    }

    const gfa = footprintArea * floors;
    const bcr = item.area > 0 ? (footprintArea / item.area) : 0;
    const far = item.area > 0 ? (gfa / item.area) : 0;

    // Check violations
    const heightViolation = height > item.params.maxHeight;
    const bcrViolation = bcr > item.params.maxBcr;
    const farViolation = far > item.params.maxFar;
    const hasViolation = heightViolation || bcrViolation || farViolation;

    // 3. Build Zoning Envelope (Modelur Style)
    buildZoningEnvelope(item, insetRing, item.params.maxHeight, hasViolation);

    // 4. Build Building Massing
    const bldShape = new THREE.Shape();
    insetRing.forEach((pt, i) => {
        if (i === 0) bldShape.moveTo(pt.x, pt.y);
        else bldShape.lineTo(pt.x, pt.y);
    });

    let bldGeom;
    if (typology === 'Courtyard') {
        const innerSetback = 8;
        const innerRing = offsetPolygonRing(insetRing, innerSetback);
        if (innerRing && innerRing.length >= 3) {
            const hole = new THREE.Path();
            innerRing.forEach((pt, i) => {
                if (i === 0) hole.moveTo(pt.x, pt.y);
                else hole.lineTo(pt.x, pt.y);
            });
            bldShape.holes.push(hole);
        }
        bldGeom = new THREE.ExtrudeGeometry(bldShape, { depth: height, bevelEnabled: false });
    } else if (typology === 'Slab') {
        const slabShape = buildSlabShape(insetRing, 12);
        bldGeom = new THREE.ExtrudeGeometry(slabShape, { depth: height, bevelEnabled: false });
    } else {
        bldGeom = new THREE.ExtrudeGeometry(bldShape, { depth: height, bevelEnabled: false });
    }

    bldGeom.rotateX(-Math.PI / 2);
    bldGeom.translate(0, height, 0);

    // Generate Facade Window Texture
    const mats = getBuildingMaterials(usage, floors);

    const bldMesh = new THREE.Mesh(bldGeom, mats);
    bldMesh.castShadow = true;
    bldMesh.receiveShadow = true;
    bldMesh.userData = { parcelItem: item };
    scene.add(bldMesh);
    item.buildingMesh = bldMesh;

    // Add Rooftop Details (penthouses, HVAC, solar panels)
    addRooftopDetails(bldMesh, insetRing, height, usage);
}

// Generate textured building materials with window grids dynamically
function getBuildingMaterials(usage, floors) {
    let colorHex = '#e2e8f0';
    if (usage === 'Residential') {
        colorHex = '#d97706'; // warm amber
    } else if (usage === 'Commercial') {
        colorHex = '#1d4ed8'; // blue glass
    } else if (usage === 'Civic') {
        colorHex = '#0d9488'; // teal civic
    }

    const wallTex = createFacadeTexture(colorHex, usage);
    // scale texture repetition to match height/floors
    wallTex.repeat.set(6, floors);

    const wallMat = new THREE.MeshStandardMaterial({
        map: wallTex,
        roughness: 0.3,
        metalness: 0.1
    });

    const roofMat = new THREE.MeshStandardMaterial({
        color: 0x334155, // concrete grey roof
        roughness: 0.8
    });

    // In Three.js ExtrudeGeometry, index 0 is for caps, index 1 is for sides (walls)
    return [roofMat, wallMat];
}

// Canvas-drawn texture mapping for realistic windows
function createFacadeTexture(wallColor, usage) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');

    // Draw wall base
    ctx.fillStyle = wallColor;
    ctx.fillRect(0, 0, 256, 256);

    // Draw Window Grids
    const isCommercial = usage === 'Commercial';
    ctx.fillStyle = isCommercial ? '#93c5fd' : '#fef08a'; // cyan glass vs yellow light
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2;

    const cols = 6;
    const rows = 3;
    const w = 28;
    const h = 55;
    const gapX = (256 - cols * w) / (cols + 1);
    const gapY = (256 - rows * h) / (rows + 1);

    for (let r = 0; r < rows; r++) {
        // Ground floor gets storefronts/doors
        const isGround = (r === rows - 1);
        
        for (let c = 0; c < cols; c++) {
            const x = gapX + c * (w + gapX);
            const y = gapY + r * (h + gapY);

            if (isGround && (c === 2 || c === 3)) {
                // Entrance door
                ctx.fillStyle = '#1e293b';
                ctx.fillRect(x, y, w, h + gapY);
                // Glass panel inside door
                ctx.fillStyle = '#93c5fd';
                ctx.fillRect(x + 4, y + 4, w - 8, h / 2);
                ctx.fillStyle = isCommercial ? '#93c5fd' : '#fef08a';
            } else {
                ctx.fillRect(x, y, w, h);
                ctx.strokeRect(x, y, w, h);

                // Window subdivisions
                ctx.beginPath();
                ctx.moveTo(x + w / 2, y);
                ctx.lineTo(x + w / 2, y + h);
                ctx.moveTo(x, y + h / 2);
                ctx.lineTo(x + w, y + h / 2);
                ctx.stroke();
            }
        }
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    return texture;
}

// Rooftop elements (HVAC units, elevator penthouses, solar panels)
function addRooftopDetails(parentMesh, insetRing, height, usage) {
    // Calculate centroid of the footprint
    let cx = 0, cy = 0;
    insetRing.forEach(pt => { cx += pt.x; cy += pt.y; });
    cx /= insetRing.length;
    cy /= insetRing.length;

    // Penthouse/elevator shaft
    const pentGeom = new THREE.BoxGeometry(6, 3, 6);
    const pentMat = new THREE.MeshStandardMaterial({ color: 0x475569 });
    const penthouse = new THREE.Mesh(pentGeom, pentMat);
    // position at centroid
    penthouse.position.set(cx, height + 1.5, -cy);
    penthouse.castShadow = true;
    parentMesh.add(penthouse);

    // HVAC boxes
    const hvacGeom = new THREE.BoxGeometry(2, 1.2, 2);
    const hvacMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.9, roughness: 0.2 });
    for (let i = 0; i < 2; i++) {
        const hvac = new THREE.Mesh(hvacGeom, hvacMat);
        hvac.position.set(cx - 5 + i * 10, height + 0.6, -cy + 5);
        hvac.castShadow = true;
        parentMesh.add(hvac);
    }

    // Solar panels
    if (usage !== 'Residential') {
        const panelGeom = new THREE.BoxGeometry(3, 0.1, 1.6);
        const panelMat = new THREE.MeshStandardMaterial({ color: 0x1d4ed8, roughness: 0.1 });
        for (let i = -1; i <= 1; i++) {
            const panel = new THREE.Mesh(panelGeom, panelMat);
            panel.rotation.x = -Math.PI / 6; // Angle tilt
            panel.position.set(cx + i * 4, height + 0.5, -cy - 5);
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

    const envColor = isViolated ? 0xef4444 : 0x10b981; // neon red if violation, neon green if compliant
    const envMat = new THREE.MeshStandardMaterial({
        color: envColor,
        transparent: true,
        opacity: isViolated ? 0.25 : 0.08,
        side: THREE.DoubleSide,
        depthWrite: false,
        wireframe: false
    });

    const envMesh = new THREE.Mesh(envGeom, envMat);
    scene.add(envMesh);
    item.zoningMesh = envMesh;

    // Structural outline edges
    const edges = new THREE.EdgesGeometry(envGeom);
    const lineMat = new THREE.LineBasicMaterial({
        color: envColor,
        linewidth: 1.5,
        transparent: true,
        opacity: isViolated ? 0.7 : 0.35
    });
    const line = new THREE.LineSegments(edges, lineMat);
    envMesh.add(line);
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

// Click listener to select building and open panel details
function onDocumentClick(event) {
    if (event.target.closest('#control-dock') || event.target.closest('.hud-bar') || event.target.closest('.loading-screen')) return;

    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    const meshes = [];
    parcelFeatures.forEach(item => {
        if (item.parcelMesh) meshes.push(item.parcelMesh);
        if (item.buildingMesh) meshes.push(item.buildingMesh);
    });

    const intersects = raycaster.intersectObjects(meshes);

    if (intersects.length > 0) {
        const hitObject = intersects[0].object;
        const item = hitObject.userData.parcelItem;
        selectParcel(item);
    } else {
        deselectParcel();
    }
}

// Handle parcel selection, loading values to sliders
function selectParcel(item) {
    if (selectedParcel && selectedParcel.buildingMesh) {
        selectedParcel.buildingMesh.material[1].opacity = 0.85;
        selectedParcel.buildingMesh.material[1].emissive.setHex(0x000000);
    }

    selectedParcel = item;
    
    if (selectedParcel.buildingMesh) {
        selectedParcel.buildingMesh.material[1].opacity = 1.0;
        selectedParcel.buildingMesh.material[1].emissive.setHex(0x111e0e);
    }

    // Populate sliders
    inSetback.value = item.params.setback;
    inFloors.value = item.params.floors;
    inFloorHeight.value = item.params.floorHeight;
    inTypology.value = item.params.typology;
    inUsage.value = item.params.usage;
    
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

    metFid.textContent = item.fid;
    metArea.textContent = Math.round(item.area).toLocaleString() + " m²";

    // Show controls
    placeholderEl.classList.add('hidden');
    controlsEl.classList.remove('hidden');

    updateDashboard(item);
}

// Deselect selected parcel and hide controls panel
function deselectParcel() {
    if (selectedParcel && selectedParcel.buildingMesh) {
        selectedParcel.buildingMesh.material[1].opacity = 0.85;
        selectedParcel.buildingMesh.material[1].emissive.setHex(0x000000);
    }
    selectedParcel = null;

    placeholderEl.classList.remove('hidden');
    controlsEl.classList.add('hidden');
}

// Live calculation of regulatory compliance metrics (FAR, BCR, Height)
function updateDashboard(item) {
    const setback = item.params.setback;
    const floors = item.params.floors;
    const height = floors * item.params.floorHeight;
    
    // Calculate footprint area
    const insetRing = offsetPolygonRing(item.outerRing, setback);
    let footprintArea = 0;
    
    if (insetRing && insetRing.length >= 3) {
        if (item.params.typology === 'Courtyard') {
            const innerSetback = 8;
            const innerRing = offsetPolygonRing(insetRing, innerSetback);
            const outerArea = calculatePolygonArea(insetRing);
            const innerArea = innerRing ? calculatePolygonArea(innerRing) : 0;
            footprintArea = Math.max(0, outerArea - innerArea);
        } else if (item.params.typology === 'Slab') {
            const slabShape = buildSlabShape(insetRing, 12);
            footprintArea = calculateShapeArea(slabShape);
        } else { // Tower
            footprintArea = calculatePolygonArea(insetRing);
        }
    }

    const gfa = footprintArea * floors;
    const bcr = item.area > 0 ? (footprintArea / item.area) : 0;
    const far = item.area > 0 ? (gfa / item.area) : 0;

    // Update UI elements
    metFootprint.textContent = Math.round(footprintArea).toLocaleString() + " m²";
    metGfa.textContent = Math.round(gfa).toLocaleString() + " m²";
    metHeight.textContent = height.toFixed(1) + " m";
    
    // Actual vs Limit
    metBcrLabel.textContent = `${bcr.toFixed(2)} / ${item.params.maxBcr.toFixed(2)}`;
    metFarLabel.textContent = `${far.toFixed(2)} / ${item.params.maxFar.toFixed(2)}`;

    // Set colors of BCR/FAR labels based on violations
    metBcrLabel.style.color = bcr > item.params.maxBcr ? "#ef4444" : "#10b981";
    metFarLabel.style.color = far > item.params.maxFar ? "#ef4444" : "#10b981";
    metHeight.style.color = height > item.params.maxHeight ? "#ef4444" : "#10b981";

    // Violation Check
    const heightViolated = height > item.params.maxHeight;
    const bcrViolated = bcr > item.params.maxBcr;
    const farViolated = far > item.params.maxFar;
    const violated = heightViolated || bcrViolated || farViolated || footprintArea === 0;
    
    metStatus.textContent = violated ? "VIOLATION" : "COMPLIANT";
    metStatus.className = "stat-val status-badge " + (violated ? "violation" : "compliant");
}

// POST modifications back to the local Python QGIS server
async function syncToQGIS() {
    if (!selectedParcel) return;

    btnSync.disabled = true;
    btnSync.textContent = "Syncing...";

    const setback = selectedParcel.params.setback;
    const insetRing = offsetPolygonRing(selectedParcel.outerRing, setback);
    
    let geoCoords = [];
    if (insetRing) {
        geoCoords = insetRing.map(pt => {
            return [pt.x + centerX, pt.y + centerY];
        });
    }

    const payload = {
        updates: [
            {
                id: selectedParcel.fid,
                far: parseFloat(metFarLabel.textContent.split(" / ")[0]),
                bcr: parseFloat(metBcrLabel.textContent.split(" / ")[0]),
                gfa: parseFloat(metGfa.textContent.replace(/\D/g, '')),
                setback: selectedParcel.params.setback,
                floors: selectedParcel.params.floors,
                floor_h: selectedParcel.params.floorHeight,
                typology: selectedParcel.params.typology,
                usage: selectedParcel.params.usage,
                // Sync zoning limits too
                max_bcr: selectedParcel.params.maxBcr,
                max_far: selectedParcel.params.maxFar,
                max_height: selectedParcel.params.maxHeight,
                coordinates: geoCoords
            }
        ]
    };

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
            alert("Successfully synced modifications back to QGIS!");
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

    const N = ring.length;
    const offsetSegments = [];

    // Calculate inward shifted segments
    for (let i = 0; i < N; i++) {
        const p1 = ring[i];
        const p2 = ring[(i + 1) % N];

        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const len = Math.sqrt(dx*dx + dy*dy);
        if (len < 0.001) continue;

        // Inward pointing normal
        const nx = -dy / len;
        const ny = dx / len;

        offsetSegments.push({
            p1: { x: p1.x + nx * distance, y: p1.y + ny * distance },
            p2: { x: p2.x + nx * distance, y: p2.y + ny * distance },
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
            // Increase buffer if distance is negative (outward offset)
            const checkDist = Math.abs(distance);
            if (d1 > checkDist * 4) return null; // self-intersection/degenerate
            insetRing.push(pt);
        } else {
            insetRing.push({ x: s2.p1.x, y: s2.p1.y });
        }
    }

    return insetRing;
}

// Find intersection point of two infinite 2D lines (Point + Direction vector)
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
