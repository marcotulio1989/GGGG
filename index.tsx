/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';

type RockData = {
  model: THREE.Group;
  name: string;
  size: THREE.Vector3;
  box: THREE.Box3;
};

type FoliageData = {
  model: THREE.Group;
  name: string;
};


interface ContourPoint {
  position: THREE.Vector3;
  normal: THREE.Vector3;
  angle: number;
}

interface PlaceFoliageOptions {
    targetMesh: THREE.Mesh;
    models: FoliageData[];
    densityInput: HTMLInputElement;
    maxCountInput: HTMLInputElement;
    maxSlopeInput: HTMLInputElement;
    scaleInput: HTMLInputElement;
    outerBoundary: THREE.Vector3[];
    innerBoundary: THREE.Vector3[];
    foliageBandWidth: number;
    debugLabel: string;
    outputElement: HTMLElement;
}

interface Lake {
    type: 'lake';
    id: number;
    baseRadius: number;
    depth: number;
    // Generated properties
    center?: THREE.Vector2;
    waterLevel?: number;
    contourPoints?: THREE.Vector2[];
    irregularity?: number;
    avgRimHeight?: number;
}

interface MudPuddle {
    type: 'mud_puddle';
    id: number;
    baseRadius: number;
    depth: number; // Add depth property to match usage
    // Generated properties
    center?: THREE.Vector2;
    contourPoints?: THREE.Vector2[];
    irregularity?: number;
    avgRimHeight?: number;
    noiseParams?: {
        harmonics: { freq: number; amp: number }[];
        phaseOffset: number;
        totalAmplitude: number;
    }
}


// Helper for Delaunay triangulation
type Vertex2D = { x: number; z: number, originalIndex: number };
type Edge2D = { v0: Vertex2D; v1: Vertex2D };
type Triangle2D = { v0: Vertex2D; v1: Vertex2D; v2: Vertex2D; circumcircle?: { x: number; z: number; radiusSq: number } };

class UnionFind {
    private parent: number[];
    constructor(n: number) {
        this.parent = Array.from({ length: n }, (_, i) => i);
    }
    find(i: number): number {
        if (this.parent[i] === i) return i;
        return this.parent[i] = this.find(this.parent[i]);
    }
    union(i: number, j: number): void {
        const rootI = this.find(i);
        const rootJ = this.find(j);
        if (rootI !== rootJ) {
            this.parent[rootI] = rootJ;
        }
    }
}


class IslandGeneratorApp {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private fbxLoader: FBXLoader;
  private objLoader: OBJLoader;
  private rockModels: RockData[] = [];
  private foliageModels: FoliageData[] = [];
  private group: THREE.Group; // Group to hold all arranged rocks
  private foliageGroup: THREE.Group; // Group to hold foliage
  private pathGroup: THREE.Group; // Group to hold paths
  private waterGroup: THREE.Group; // Group to hold water features
  private contourLine: THREE.Line | null = null;
  private foliageBoundaryLine: THREE.Line | null = null;
  private outerContourLine: THREE.Line | null = null;
  private islandSurface: THREE.Mesh | null = null;
  private groundCoverMesh: THREE.Mesh | null = null;
  private perlin: ImprovedNoise;

  private grassMaterial: THREE.MeshStandardMaterial;
  private mudMaterial: THREE.MeshStandardMaterial;
  private rockMaterial: THREE.MeshStandardMaterial;
  private groundCoverMaterial: THREE.MeshStandardMaterial;
  private foliageMaterial: THREE.MeshStandardMaterial;
  private pathMaterial: THREE.MeshStandardMaterial;
  private waterMaterial: THREE.MeshStandardMaterial;

  // Interactive state
  private lakes: Lake[] = [];
  private mudPuddles: MudPuddle[] = [];
  private currentInnerFoliageBoundary: THREE.Vector3[] = [];
  private currentOuterFoliageBoundary: THREE.Vector3[] = [];

  // DOM Elements
  private rockModelInput: HTMLInputElement;
  private fileCountDisplay: HTMLElement;
  private generateButton: HTMLButtonElement;
  private loadingOverlay: HTMLElement;
  private islandRadiusInput: HTMLInputElement;
  private shorelineOffsetInput: HTMLInputElement;
  private shorelineHeightInput: HTMLInputElement;
  private contourHeightInput: HTMLInputElement;
  private noiseStrengthInput: HTMLInputElement;
  private noiseScaleInput: HTMLInputElement;
  private surfaceSmoothingInput: HTMLInputElement;
  private rockHeightScaleInput: HTMLInputElement;
  
  // Foliage
  private foliageModelInput: HTMLInputElement;
  private foliageModelButton: HTMLButtonElement;
  private foliageFileCountDisplay: HTMLElement;
  private foliageDensityInput: HTMLInputElement;
  private maxFoliageSlopeInput: HTMLInputElement;
  private foliageCoordinatesList: HTMLElement;
  private maxFoliageCountInput: HTMLInputElement;
  private foliageScaleInput: HTMLInputElement;
  private foliageBandWidthInput: HTMLInputElement;
  private foliageBandWidthValue: HTMLElement;

  // Path Generation
  private pathToggleInput: HTMLInputElement;
  private pathPointsInput: HTMLInputElement;
  private pathLoopingInput: HTMLInputElement;
  private pathWidthInput: HTMLInputElement;
  private generatePathButton: HTMLButtonElement;

  // Water Features
  private waterFeaturesToggle: HTMLInputElement;
  private lakeRadiusInput: HTMLInputElement;
  private lakeDepthInput: HTMLInputElement;
  private addLakeButton: HTMLButtonElement;
  private deleteLakeButton: HTMLButtonElement;
  
  // Mud Puddles
  private mudPuddleRadiusInput: HTMLInputElement;
  private addMudPuddleButton: HTMLButtonElement;
  private deleteMudPuddleButton: HTMLButtonElement;

  // PBR Texture Set Inputs
  private grassSetButton: HTMLButtonElement;
  private grassSetInput: HTMLInputElement;
  private mudSetButton: HTMLButtonElement;
  private mudSetInput: HTMLInputElement;
  private pathSetButton: HTMLButtonElement;
  private pathSetInput: HTMLInputElement;
  private rockSetButton: HTMLButtonElement;
  private rockSetInput: HTMLInputElement;
  private groundCoverSetButton: HTMLButtonElement;
  private groundCoverSetInput: HTMLInputElement;

  // Visualizations
  private showOuterShorelineInput: HTMLInputElement;
  private showCliffEdgeInput: HTMLInputElement;
  private showFoliageBoundaryInput: HTMLInputElement;


  constructor() {
    this.perlin = new ImprovedNoise();
    this.fbxLoader = new FBXLoader();
    this.objLoader = new OBJLoader();
    this.initScene();
    
    // Initialize materials with fallback colors.
    this.grassMaterial = new THREE.MeshStandardMaterial({
        color: 0x556B2F, // DarkOliveGreen
        side: THREE.DoubleSide,
        name: 'grass',
        displacementScale: 0
    });
    this.mudMaterial = new THREE.MeshStandardMaterial({
        color: 0x8B4513, // SaddleBrown
        side: THREE.DoubleSide,
        name: 'mud',
        displacementScale: 0
    });
    this.rockMaterial = new THREE.MeshStandardMaterial({
        color: 0x808080,
        name: 'rock',
        displacementScale: 0.2,
        side: THREE.DoubleSide
    });
    this.groundCoverMaterial = new THREE.MeshStandardMaterial({
        color: 0x5C4033, // Dirt brown
        name: 'groundCover',
        displacementScale: 0.2
    });
    this.foliageMaterial = new THREE.MeshStandardMaterial({
        color: 0x4C7F3C,
        roughness: 0.8,
    });
    this.pathMaterial = new THREE.MeshStandardMaterial({
        color: 0x696969, // DimGray
        side: THREE.DoubleSide,
    });
    this.waterMaterial = new THREE.MeshStandardMaterial({
        color: 0x336699,
        transparent: true,
        opacity: 0.85,
        roughness: 0.1,
        metalness: 0.2,
        side: THREE.DoubleSide,
        depthWrite: false,
    });


    this.bindUI();
    this.addEventListeners();
    this.animate();
  }

  private initScene() {
    const canvas = document.querySelector('#c') as HTMLCanvasElement;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 10000);
    this.camera.position.set(0, 25, 50);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.target.set(0, 2, 0);
    this.controls.update();

    const ambientLight = new THREE.AmbientLight(0xffffff, 1.5);
    this.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 2.5);
    directionalLight.position.set(5, 10, 7.5);
    this.scene.add(directionalLight);
    
    const axesHelper = new THREE.AxesHelper(5);
    this.scene.add(axesHelper);

    this.group = new THREE.Group();
    this.scene.add(this.group);
    
    this.foliageGroup = new THREE.Group();
    this.scene.add(this.foliageGroup);
    
    this.pathGroup = new THREE.Group();
    this.scene.add(this.pathGroup);
    
    this.waterGroup = new THREE.Group();
    this.scene.add(this.waterGroup);


    window.addEventListener('resize', this.onWindowResize.bind(this));
  }

  private bindUI() {
    this.rockModelInput = document.getElementById('rock-model-input') as HTMLInputElement;
    this.fileCountDisplay = document.getElementById('file-count') as HTMLElement;
    this.generateButton = document.getElementById('generate-button') as HTMLButtonElement;
    this.loadingOverlay = document.getElementById('loading-overlay') as HTMLElement;
    this.islandRadiusInput = document.getElementById('island-radius-input') as HTMLInputElement;
    this.shorelineOffsetInput = document.getElementById('shoreline-offset-input') as HTMLInputElement;
    this.shorelineHeightInput = document.getElementById('shoreline-height-input') as HTMLInputElement;
    this.contourHeightInput = document.getElementById('contour-height-input') as HTMLInputElement;
    this.noiseStrengthInput = document.getElementById('noise-strength-input') as HTMLInputElement;
    this.noiseScaleInput = document.getElementById('noise-scale-input') as HTMLInputElement;
    this.surfaceSmoothingInput = document.getElementById('surface-smoothing-input') as HTMLInputElement;
    this.rockHeightScaleInput = document.getElementById('rock-height-scale-input') as HTMLInputElement;
    
    // Foliage
    this.foliageModelInput = document.getElementById('foliage-model-input') as HTMLInputElement;
    this.foliageModelButton = document.getElementById('foliage-model-button') as HTMLButtonElement;
    this.foliageFileCountDisplay = document.getElementById('foliage-file-count') as HTMLElement;
    this.foliageDensityInput = document.getElementById('foliage-density-input') as HTMLInputElement;
    this.maxFoliageSlopeInput = document.getElementById('max-foliage-slope-input') as HTMLInputElement;
    this.foliageCoordinatesList = document.getElementById('foliage-coordinates-list') as HTMLElement;
    this.maxFoliageCountInput = document.getElementById('max-foliage-count-input') as HTMLInputElement;
    this.foliageScaleInput = document.getElementById('foliage-scale-input') as HTMLInputElement;
    this.foliageBandWidthInput = document.getElementById('foliage-band-width-input') as HTMLInputElement;
    this.foliageBandWidthValue = document.getElementById('foliage-band-width-value') as HTMLElement;

    // Path Generation
    this.pathToggleInput = document.getElementById('path-toggle-input') as HTMLInputElement;
    this.pathPointsInput = document.getElementById('path-points-input') as HTMLInputElement;
    this.pathLoopingInput = document.getElementById('path-looping-input') as HTMLInputElement;
    this.pathWidthInput = document.getElementById('path-width-input') as HTMLInputElement;
    this.generatePathButton = document.getElementById('generate-path-button') as HTMLButtonElement;

    // Water Features
    this.waterFeaturesToggle = document.getElementById('water-features-toggle') as HTMLInputElement;
    this.lakeRadiusInput = document.getElementById('lake-radius-input') as HTMLInputElement;
    this.lakeDepthInput = document.getElementById('lake-depth-input') as HTMLInputElement;
    this.addLakeButton = document.getElementById('add-lake-button') as HTMLButtonElement;
    this.deleteLakeButton = document.getElementById('delete-lake-button') as HTMLButtonElement;
    
    // Mud Puddles
    this.mudPuddleRadiusInput = document.getElementById('mud-puddle-radius-input') as HTMLInputElement;
    this.addMudPuddleButton = document.getElementById('add-mud-puddle-button') as HTMLButtonElement;
    this.deleteMudPuddleButton = document.getElementById('delete-mud-puddle-button') as HTMLButtonElement;

    // PBR Texture Set Inputs
    this.grassSetButton = document.getElementById('grass-set-button') as HTMLButtonElement;
    this.grassSetInput = document.getElementById('grass-set-input') as HTMLInputElement;
    this.mudSetButton = document.getElementById('mud-set-button') as HTMLButtonElement;
    this.mudSetInput = document.getElementById('mud-set-input') as HTMLInputElement;
    this.pathSetButton = document.getElementById('path-set-button') as HTMLButtonElement;
    this.pathSetInput = document.getElementById('path-set-input') as HTMLInputElement;
    this.rockSetButton = document.getElementById('rock-set-button') as HTMLButtonElement;
    this.rockSetInput = document.getElementById('rock-set-input') as HTMLInputElement;
    this.groundCoverSetButton = document.getElementById('ground-cover-set-button') as HTMLButtonElement;
    this.groundCoverSetInput = document.getElementById('ground-cover-set-input') as HTMLInputElement;

    // Visualizations
    this.showOuterShorelineInput = document.getElementById('show-outer-shoreline-input') as HTMLInputElement;
    this.showCliffEdgeInput = document.getElementById('show-cliff-edge-input') as HTMLInputElement;
    this.showFoliageBoundaryInput = document.getElementById('show-foliage-boundary-input') as HTMLInputElement;

    // Initialize display values
    this.foliageBandWidthValue.textContent = parseFloat(this.foliageBandWidthInput.value).toFixed(1);
  }

  private addEventListeners() {
    this.rockModelInput.addEventListener('change', this.handleFileSelect.bind(this));
    this.generateButton.addEventListener('click', () => this.generateIsland());
    
    this.foliageModelButton.addEventListener('click', () => this.foliageModelInput.click());
    this.foliageModelInput.addEventListener('change', this.handleFoliageModelSelect.bind(this));

    this.generatePathButton.addEventListener('click', () => this.generateGraphPaths());

    this.foliageBandWidthInput.addEventListener('input', () => {
        if (this.foliageBandWidthValue) {
            this.foliageBandWidthValue.textContent = parseFloat(this.foliageBandWidthInput.value).toFixed(1);
        }
    });

    // Water feature listeners
    this.addLakeButton.addEventListener('click', this.handleAddLake.bind(this));
    this.deleteLakeButton.addEventListener('click', this.handleDeleteLastLake.bind(this));

    // Mud puddle listeners
    this.addMudPuddleButton.addEventListener('click', this.handleAddMudPuddle.bind(this));
    this.deleteMudPuddleButton.addEventListener('click', this.handleDeleteLastMudPuddle.bind(this));

    // PBR Texture Set Listeners
    this.grassSetButton.addEventListener('click', () => this.grassSetInput.click());
    this.grassSetInput.addEventListener('change', (e) => this.handleTextureSetUpload(
        e, this.grassMaterial,
        {
            map: 'grass-albedo-filename', normalMap: 'grass-normal-filename',
            roughnessMap: 'grass-roughness-filename', aoMap: 'grass-ao-filename',
            displacementMap: 'grass-displacement-filename',
        }, 0x556B2F
    ));

    this.mudSetButton.addEventListener('click', () => this.mudSetInput.click());
    this.mudSetInput.addEventListener('change', (e) => this.handleTextureSetUpload(
        e, this.mudMaterial,
        {
            map: 'mud-albedo-filename', normalMap: 'mud-normal-filename',
            roughnessMap: 'mud-roughness-filename', aoMap: 'mud-ao-filename',
            displacementMap: 'mud-displacement-filename',
        }, 0x8B4513
    ));

    this.pathSetButton.addEventListener('click', () => this.pathSetInput.click());
    this.pathSetInput.addEventListener('change', (e) => this.handleTextureSetUpload(
        e, this.pathMaterial,
        {
            map: 'path-albedo-filename', normalMap: 'path-normal-filename',
            roughnessMap: 'path-roughness-filename', aoMap: 'path-ao-filename',
            displacementMap: 'path-displacement-filename',
        }, 0x696969
    ));

    this.rockSetButton.addEventListener('click', () => this.rockSetInput.click());
    this.rockSetInput.addEventListener('change', (e) => this.handleTextureSetUpload(
        e, this.rockMaterial,
        {
            map: 'rock-albedo-filename', normalMap: 'rock-normal-filename',
            roughnessMap: 'rock-roughness-filename', aoMap: 'rock-ao-filename',
            displacementMap: 'rock-displacement-filename',
        }, 0x808080
    ));
    
    this.groundCoverSetButton.addEventListener('click', () => this.groundCoverSetInput.click());
    this.groundCoverSetInput.addEventListener('change', (e) => this.handleTextureSetUpload(
        e, this.groundCoverMaterial,
        {
            map: 'ground-cover-albedo-filename', normalMap: 'ground-cover-normal-filename',
            roughnessMap: 'ground-cover-roughness-filename', aoMap: 'ground-cover-ao-filename',
            displacementMap: 'ground-cover-displacement-filename',
        }, 0x5C4033
    ));

    // Visualization Listeners
    this.showOuterShorelineInput.addEventListener('change', () => {
        if (this.outerContourLine) this.outerContourLine.visible = this.showOuterShorelineInput.checked;
    });
    this.showCliffEdgeInput.addEventListener('change', () => {
        if (this.contourLine) this.contourLine.visible = this.showCliffEdgeInput.checked;
    });
    this.showFoliageBoundaryInput.addEventListener('change', () => {
        if (this.foliageBoundaryLine) this.foliageBoundaryLine.visible = this.showFoliageBoundaryInput.checked;
    });
  }

    private loadTextureFromFile(
        file: File,
        material: THREE.MeshStandardMaterial,
        mapType: 'map' | 'normalMap' | 'roughnessMap' | 'aoMap' | 'displacementMap'
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const dataUrl = e.target?.result as string;
                if (!dataUrl) {
                    return reject(new Error('Failed to read file data.'));
                }

                const textureLoader = new THREE.TextureLoader();
                textureLoader.load(dataUrl, 
                    (texture) => {
                        texture.wrapS = THREE.RepeatWrapping;
                        texture.wrapT = THREE.RepeatWrapping;
                        texture.needsUpdate = true;

                        material[mapType] = texture;
                        if (mapType === 'map' && material.color) {
                            material.color.set(0xffffff); // Set color to white to show texture fully
                        }
                        material.needsUpdate = true;
                        resolve();
                    },
                    undefined, // onProgress callback
                    (errorEvent) => {
                        const message = `Failed to load texture from file "${file.name}". Please ensure it is a valid image file.`;
                        console.error(message, errorEvent);
                        reject(new Error(message));
                    }
                );
            };
            reader.onerror = (err) => {
                const message = `Error reading file "${file.name}".`;
                console.error(message, err);
                reject(new Error(message));
            };
            reader.readAsDataURL(file);
        });
    }

    private async handleTextureSetUpload(
        event: Event, 
        material: THREE.MeshStandardMaterial, 
        filenameElementsMap: Record<string, string>,
        defaultColor: number
    ) {
        const input = event.target as HTMLInputElement;
        if (!input.files || input.files.length === 0) return;

        this.showLoading(true, `Loading ${material.name} textures...`);

        const files = Array.from(input.files);

        const mapTypeKeywords: Record<string, string[]> = {
            map: ['albedo', 'diffuse', 'diff', 'col', 'color', 'basecolor'],
            normalMap: ['normal', 'nor', 'nrm'],
            roughnessMap: ['roughness', 'rough'],
            aoMap: ['ao', 'ambientocclusion', 'occlusion'],
            displacementMap: ['displacement', 'disp', 'height']
        };

        const filenameElements: Record<string, HTMLElement | null> = {};
        for (const key in filenameElementsMap) {
            filenameElements[key] = document.getElementById(filenameElementsMap[key]);
        }
        
        // Reset display and material properties
        for (const key in filenameElements) {
            if (filenameElements[key]) {
                filenameElements[key]!.textContent = 'No file chosen';
            }
            (material as any)[key] = null;
        }
        material.color.set(defaultColor);
        material.needsUpdate = true;

        const texturePromises = files.map(file => {
            const lowerCaseName = file.name.toLowerCase();
            let assignedMapType: string | null = null;

            for (const [mapType, keywords] of Object.entries(mapTypeKeywords)) {
                if (keywords.some(keyword => lowerCaseName.includes(keyword))) {
                    assignedMapType = mapType;
                    break;
                }
            }
            
            if (assignedMapType) {
                const el = filenameElements[assignedMapType];
                if (el) {
                    el.textContent = file.name;
                }
                return this.loadTextureFromFile(file, material, assignedMapType as any);
            }
            return Promise.resolve();
        });
        
        try {
            await Promise.all(texturePromises);
        } catch (error) {
            console.error("Error loading texture set:", error);
            const message = error instanceof Error ? error.message : "An error occurred while loading one or more textures. Check the console for details.";
            alert(message);
        } finally {
            this.showLoading(false);
            // Reset input value to allow re-uploading the same file set
            input.value = '';
        }
    }
  
  private async handleFoliageModelSelect(event: Event) {
    const files = (event.target as HTMLInputElement).files;
    if (!files || files.length === 0) {
      this.foliageModels.length = 0; // Clear the array
      this.foliageFileCountDisplay.textContent = 'No files selected.';
      return;
    }
    
    this.showLoading(true, `Loading foliage models...`);
    this.foliageModels.length = 0; // Clear the array before loading new ones
    const loadPromises: Promise<void>[] = [];

    for (const file of files) {
      loadPromises.push(this.loadFoliageFile(file, this.foliageModels));
    }

    try {
      await Promise.all(loadPromises);
    } catch (error) {
      console.error(`Error loading foliage files:`, error);
      alert(`There was an error loading one or more foliage model files. Check the console for details.`);
    } finally {
      this.showLoading(false);
      const numFiles = this.foliageModels.length;
      this.foliageFileCountDisplay.textContent = numFiles > 0 ? `${numFiles} model${numFiles > 1 ? 's' : ''} loaded.` : 'No valid models selected.';
    }
  }

  private loadFoliageFile(file: File, modelArray: FoliageData[]): Promise<void> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        const fileExtension = file.name.split('.').pop()?.toLowerCase();

        reader.onload = (e) => {
            const contents = e.target?.result;
            if (!contents) {
                return reject(new Error(`Failed to read file: ${file.name}`));
            }
            try {
                let object: THREE.Group;
                if (fileExtension === 'obj' && typeof contents === 'string') {
                    object = this.objLoader.parse(contents);
                } else if (fileExtension === 'fbx' && contents instanceof ArrayBuffer) {
                    object = this.fbxLoader.parse(contents, '');
                } else {
                    console.warn(`Skipping file with unsupported type or content mismatch: ${file.name}`);
                    return resolve();
                }

                let hasGeometry = false;
                object.traverse(child => {
                    if (child instanceof THREE.Mesh) {
                        hasGeometry = true;
                    }
                });
                if (!hasGeometry) {
                    throw new Error(`Parsed model "${file.name}" contains no usable mesh geometry.`);
                }

                object.traverse((child) => {
                    if (child instanceof THREE.Mesh) {
                        // Use a shared material instance for performance
                        child.material = this.foliageMaterial;
                        child.castShadow = true;
                    }
                });
                
                modelArray.push({
                    model: object,
                    name: file.name
                });
                resolve();
            } catch (error) {
                const e = error as Error;
                reject(new Error(`Failed to parse ${file.name}: ${e.message}`));
            }
        };
        reader.onerror = (err) => reject(new Error(`Error reading file ${file.name}: ${err}`));
        
        if (fileExtension === 'obj') {
            reader.readAsText(file);
        } else if (fileExtension === 'fbx') {
            reader.readAsArrayBuffer(file);
        } else {
            console.warn(`Skipping unsupported file type: ${file.name}`);
            resolve();
        }
    });
  }

  private async handleFileSelect(event: Event) {
    const files = (event.target as HTMLInputElement).files;
    if (!files || files.length === 0) {
      this.rockModels = [];
      this.generateButton.disabled = true;
      this.fileCountDisplay.textContent = 'No files selected.';
      return;
    }
    
    this.showLoading(true, "Loading models...");
    this.rockModels = [];
    const loadPromises: Promise<void>[] = [];

    for (const file of files) {
      loadPromises.push(this.loadFile(file));
    }

    try {
      await Promise.all(loadPromises);
    } catch (error) {
      console.error('Error loading files:', error);
      alert('There was an error loading one or more model files. Check the console for details.');
    } finally {
      this.showLoading(false);
      const numFiles = this.rockModels.length;
      this.fileCountDisplay.textContent = numFiles > 0 ? `${numFiles} model${numFiles > 1 ? 's' : ''} loaded.` : 'No valid models selected.';
      this.generateButton.disabled = numFiles === 0;
    }
  }

  private loadFile(file: File): Promise<void> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        const fileExtension = file.name.split('.').pop()?.toLowerCase();

        reader.onload = (e) => {
            const contents = e.target?.result;
            if (!contents) {
                return reject(new Error(`Failed to read file: ${file.name}`));
            }
            try {
                let object: THREE.Group;
                if (fileExtension === 'obj' && typeof contents === 'string') {
                    object = this.objLoader.parse(contents);
                } else if (fileExtension === 'fbx' && contents instanceof ArrayBuffer) {
                    object = this.fbxLoader.parse(contents, '');
                } else {
                    // This path should ideally not be taken due to the check below,
                    // but it's a safeguard.
                    console.warn(`Skipping file with unsupported type or content mismatch: ${file.name}`);
                    return resolve();
                }

                let hasGeometry = false;
                object.traverse(child => {
                    if (child instanceof THREE.Mesh) {
                        hasGeometry = true;
                    }
                });
                if (!hasGeometry) {
                    throw new Error(`Parsed model "${file.name}" contains no usable mesh geometry.`);
                }

                const box = new THREE.Box3().setFromObject(object);
                const size = new THREE.Vector3();
                box.getSize(size);
                
                // Apply the current rock material (default color or user-uploaded)
                object.traverse((child) => {
                    if (child instanceof THREE.Mesh) {
                        child.material = this.rockMaterial;
                        if (child.geometry.attributes.uv && !child.geometry.attributes.uv2) {
                            child.geometry.setAttribute('uv2', child.geometry.attributes.uv);
                        }
                    }
                });
                
                this.rockModels.push({
                    model: object,
                    name: file.name,
                    size: size,
                    box: box,
                });
                resolve();
            } catch (error) {
                const e = error as Error;
                reject(new Error(`Failed to parse ${file.name}: ${e.message}`));
            }
        };
        reader.onerror = (err) => reject(new Error(`Error reading file ${file.name}: ${err}`));
        
        if (fileExtension === 'obj') {
            reader.readAsText(file);
        } else if (fileExtension === 'fbx') {
            reader.readAsArrayBuffer(file);
        } else {
            console.warn(`Skipping unsupported file type: ${file.name}`);
            resolve(); // Don't block other files from loading
        }
    });
  }
  
  /**
   * Generates a set of noise values for creating natural contours.
   * @param numPoints The number of noise values to generate.
   * @param phaseOffset A random offset to change the starting point of the noise.
   * @returns An array of normalized noise values.
   */
  private generateNoise(
    numPoints: number,
    phaseOffset: number,
    customHarmonics?: { freq: number; amp: number }[]
  ): number[] {
      const noiseValues = new Array(numPoints).fill(0);
      const harmonics = customHarmonics ?? [
          { freq: 1, amp: 1.0 },   // Base shape
          { freq: 2, amp: 0.5 },   // Medium details
          { freq: 5, amp: 0.25 },  // Finer details
          { freq: 9, amp: 0.125 }, // Very fine details
      ];

      let totalAmplitude = 0;
      harmonics.forEach(h => totalAmplitude += h.amp);

      for (const harmonic of harmonics) {
          const phase = phaseOffset + Math.random() * 2 * Math.PI;
          for (let i = 0; i < numPoints; i++) {
              const angle = (i / numPoints) * 2 * Math.PI;
              noiseValues[i] += Math.sin(angle * harmonic.freq + phase) * harmonic.amp;
          }
      }
      
      // Normalize to ensure the output is roughly within [-1, 1] for consistent irregularity
      for (let i = 0; i < numPoints; i++) {
          noiseValues[i] /= totalAmplitude;
      }

      return noiseValues;
  }

  /**
   * Applies a Simple Moving Average to the Y-values of a set of points.
   * @param points The input points.
   * @param windowSize The number of neighbors on each side to include in the average.
   * @returns A new array of points with smoothed Y-values.
   */
  private applySMA(points: THREE.Vector3[], windowSize: number): THREE.Vector3[] {
    if (windowSize === 0) {
        return points.map(p => p.clone()); // Return a copy if no smoothing
    }

    const smoothedPoints: THREE.Vector3[] = [];
    const numPoints = points.length;

    for (let i = 0; i < numPoints; i++) {
        let sumY = 0;
        let count = 0;
        for (let j = -windowSize; j <= windowSize; j++) {
            const index = (i + j + numPoints) % numPoints; // Wrap around for a closed loop
            sumY += points[index].y;
            count++;
        }
        
        const newPoint = points[i].clone();
        newPoint.y = sumY / count;
        smoothedPoints.push(newPoint);
    }

    return smoothedPoints;
  }

  private disposeAllGeneratedObjects() {
    // Helper to dispose of geometries within a group, as materials are shared
    const disposeGroupGeometries = (group: THREE.Group) => {
        group.traverse(object => {
            if (object instanceof THREE.Mesh) {
                object.geometry.dispose();
            }
        });
        group.clear();
    };

    // Dispose lines, which have unique materials
    if (this.contourLine) {
        this.scene.remove(this.contourLine);
        this.contourLine.geometry.dispose();
        (this.contourLine.material as THREE.Material).dispose();
    }
    if (this.foliageBoundaryLine) {
        this.scene.remove(this.foliageBoundaryLine);
        this.foliageBoundaryLine.geometry.dispose();
        (this.foliageBoundaryLine.material as THREE.Material).dispose();
    }
    if (this.outerContourLine) {
        this.scene.remove(this.outerContourLine);
        this.outerContourLine.geometry.dispose();
        (this.outerContourLine.material as THREE.Material).dispose();
    }
    
    // Dispose geometries from the main groups
    disposeGroupGeometries(this.group);
    disposeGroupGeometries(this.foliageGroup);
    disposeGroupGeometries(this.pathGroup);
    disposeGroupGeometries(this.waterGroup);
    
    if (this.generatePathButton) {
        this.generatePathButton.disabled = true;
    }

    // Clear interactive state, but keep lakes/puddles as they are manually managed
    this.currentInnerFoliageBoundary = [];
    this.currentOuterFoliageBoundary = [];
    
    // Nullify references
    this.contourLine = null;
    this.foliageBoundaryLine = null;
    this.outerContourLine = null;
    this.islandSurface = null;
    this.groundCoverMesh = null;
  }

  private async generateIsland(isRegeneration: boolean = false) {
    if (this.rockModels.length === 0) return;

    this.showLoading(true, "Generating Island...");
    this.generateButton.disabled = true;
    if (this.foliageCoordinatesList) {
        this.foliageCoordinatesList.textContent = 'Cleared. Waiting for generation...';
    }
    await new Promise(resolve => setTimeout(resolve, 20));

    try {
        this.disposeAllGeneratedObjects();
        if (!isRegeneration) {
            this.lakes = []; // Clear lakes on full regeneration
            this.mudPuddles = []; // Clear puddles on full regeneration
        }


        const baseRadius = parseFloat(this.islandRadiusInput.value);
        const shorelineOffset = parseFloat(this.shorelineOffsetInput.value);
        const shorelineHeight = parseFloat(this.shorelineHeightInput.value);
        const baseHeight = parseFloat(this.contourHeightInput.value);
        const noiseStrength = parseFloat(this.noiseStrengthInput.value);
        const noiseScale = parseFloat(this.noiseScaleInput.value);
        const surfaceSmoothing = parseInt(this.surfaceSmoothingInput.value, 10);
        const rockHeightScale = parseFloat(this.rockHeightScaleInput.value);
        const foliageBandWidth = parseFloat(this.foliageBandWidthInput.value);
        
        // Sort models by size (volume of bounding box) to partition them.
        this.rockModels.sort((a, b) => {
            const volumeA = a.size.x * a.size.y * a.size.z;
            const volumeB = b.size.x * b.size.y * b.size.z;
            return volumeA - volumeB;
        });

        // Split models into "small" and "large" sets.
        const SMALL_ROCK_PERCENTILE = 0.4;
        let splitIndex = Math.max(1, Math.floor(this.rockModels.length * SMALL_ROCK_PERCENTILE));
        if (this.rockModels.length < 2) splitIndex = 1;

        const smallRockModels = this.rockModels.slice(0, splitIndex);
        let largeRockModels = this.rockModels.slice(splitIndex);

        // Ensure largeRockModels is never empty if we have models.
        if (largeRockModels.length === 0 && smallRockModels.length > 0) {
            largeRockModels = smallRockModels;
        }

        const irregularity = 0.25;
        const DENSITY_BASE_ROCKS = 75;
        const DENSITY_BASE_RADIUS = 20;
        const DENSITY_SCALE_POWER = 1;
        const densityCoefficient = DENSITY_BASE_ROCKS / Math.pow(DENSITY_BASE_RADIUS, DENSITY_SCALE_POWER);

        // --- Generate Large Rock Contour (Inner) ---
        const numLargeRocks = Math.max(3, Math.round(densityCoefficient * Math.pow(baseRadius, DENSITY_SCALE_POWER)));
        const largeRocksGroup = new THREE.Group();
        const innerContourData: ContourPoint[] = [];
        
        const largeRockClones = Array.from({ length: numLargeRocks }, (_, i) => {
            const source = largeRockModels[i % largeRockModels.length];
            return { ...source, model: source.model.clone(true) };
        }).sort(() => Math.random() - 0.5); // Shuffle

        const largeNoise = this.generateNoise(numLargeRocks, Math.random());

        for (let i = 0; i < numLargeRocks; i++) {
            const data = largeRockClones[i];
            const { model, box } = data;
            const angle = (i / numLargeRocks) * 2 * Math.PI;
            
            const noisyRadius = baseRadius * (1 + largeNoise[i] * irregularity);
            const x = Math.cos(angle) * noisyRadius;
            const z = Math.sin(angle) * noisyRadius;

            // Base position for shoreline calculation remains at y=0.
            const position = new THREE.Vector3(x, 0, z);
            const normal = new THREE.Vector3(x, 0, z).normalize();
            innerContourData.push({ position, normal, angle });
            
            model.scale.y = rockHeightScale;
            // Position the rock's base at y=0
            model.position.set(x, -box.min.y * rockHeightScale, z);
            
            // Orient the rock to be tangential to the new ellipse shape
            const normalAngle = Math.atan2(z, x);
            model.rotation.y = -normalAngle + Math.PI / 2;

            // Re-apply the shared material to ensure texture updates are reflected
            model.traverse((child) => {
                if (child instanceof THREE.Mesh) {
                    child.material = this.rockMaterial;
                }
            });

            largeRocksGroup.add(model);
        }
        this.group.add(largeRocksGroup);
        
        // --- Generate Surface Contour From Large Rock Placement ---
        const noisyContourPoints: THREE.Vector3[] = [];
        const numSurfacePoints = 128; // Higher resolution for a smoother surface boundary

        // Create a smooth curve from the discrete rock positions to define the island edge
        const rockPositions = innerContourData.map(p => p.position);
        const rockContourCurve = new THREE.CatmullRomCurve3(rockPositions, true);
        const surfaceContourPointsXZ = rockContourCurve.getPoints(numSurfacePoints);

        for (const point of surfaceContourPointsXZ) {
            const x = point.x;
            const z = point.z;
            
            // Calculate height based on the base height and Perlin noise.
            // This makes the island surface inside the rocks follow the noise parameters.
            const noiseVal = this.perlin.noise(x * noiseScale, z * noiseScale, 0);
            const y = baseHeight + noiseVal * noiseStrength;

            noisyContourPoints.push(new THREE.Vector3(x, y, z));
        }

        // --- Smooth the noise on the contour points ---
        const smoothedNoisePoints = this.applySMA(noisyContourPoints, surfaceSmoothing);
        
        // --- Smooth the contour shape for the main island mesh (cyan line) ---
        const curve = new THREE.CatmullRomCurve3(smoothedNoisePoints, true);
        const contourPointsForLine = curve.getPoints(numSurfacePoints * 2);
        
        let maxSurfaceY = 0;
        for (const point of contourPointsForLine) {
            maxSurfaceY = Math.max(maxSurfaceY, point.y);
        }


        // --- Generate Small Rock Contour (Outer) ---
        const outerRadius = baseRadius + shorelineOffset;
        const numSmallRocks = Math.max(3, Math.round(densityCoefficient * Math.pow(outerRadius, DENSITY_SCALE_POWER)));
        const smallRocksGroup = new THREE.Group();

        const smallRockClones = Array.from({ length: numSmallRocks }, (_, i) => {
            const source = smallRockModels[i % smallRockModels.length];
            return { ...source, model: source.model.clone(true) };
        }).sort(() => Math.random() - 0.5); // Shuffle

        const smallNoise = this.generateNoise(numSmallRocks, Math.random() + Math.PI); // Offset phase for variation
        const OFFSET_IRREGULARITY = 0.5; // How much the shoreline offset varies.

        for (let i = 0; i < numSmallRocks; i++) {
            const data = smallRockClones[i];
            const { model, box } = data;

            // Find a corresponding point on the inner contour to offset from.
            const progress = i / numSmallRocks;
            const innerIndexFloat = progress * numLargeRocks;
            const index1 = Math.floor(innerIndexFloat);
            const index2 = (index1 + 1) % numLargeRocks; // Loop back to the start
            const lerpFactor = innerIndexFloat - index1;

            const data1 = innerContourData[index1];
            const data2 = innerContourData[index2];

            // Interpolate position and normal from the inner contour to create a smooth base.
            const basePosition = data1.position.clone().lerp(data2.position, lerpFactor);
            const baseNormal = data1.normal.clone().lerp(data2.normal, lerpFactor).normalize();

            // Apply a noisy offset to the base shoreline distance.
            const noisyOffset = shorelineOffset * (1 + smallNoise[i] * OFFSET_IRREGULARITY);

            // Calculate the final position by pushing the base point out along its normal.
            const finalPosition = basePosition.clone().add(baseNormal.multiplyScalar(noisyOffset));

            model.scale.y = rockHeightScale;
            model.position.set(finalPosition.x, -box.min.y * rockHeightScale, finalPosition.z);
            
            // Orient the rock to be perpendicular to the line from the origin (tangential to the island).
            const finalAngle = Math.atan2(finalPosition.z, finalPosition.x);
            model.rotation.y = -finalAngle + Math.PI / 2;
            
            // Re-apply the shared material to ensure texture updates are reflected
            model.traverse((child) => {
                if (child instanceof THREE.Mesh) {
                    child.material = this.rockMaterial;
                }
            });

            smallRocksGroup.add(model);
        }
        this.group.add(smallRocksGroup);
        
        // --- Raycasting setup for shoreline height ---
        const raycaster = new THREE.Raycaster();
        const rockMeshes: THREE.Mesh[] = [];
        this.group.traverse(child => {
            if (child instanceof THREE.Mesh) {
                rockMeshes.push(child);
            }
        });

        const getTerrainHeight = (x: number, z: number, fallbackHeight: number): number => {
            const origin = new THREE.Vector3(x, 100, z); // Start ray from high above
            const direction = new THREE.Vector3(0, -1, 0);
            raycaster.set(origin, direction);
            
            const intersects = raycaster.intersectObjects(rockMeshes, true);
            
            if (intersects.length > 0) {
                return Math.max(intersects[0].point.y, fallbackHeight);
            }
            
            return fallbackHeight;
        };


        // --- Generate Outer Contour Line (Shoreline Base) ---
        const outerContourPoints: THREE.Vector3[] = [];
        const numOuterContourPoints = 128; // Use more points for a smoother line than the rocks themselves.

        for (let i = 0; i < numOuterContourPoints; i++) {
            const progress = i / numOuterContourPoints;
            const innerIndexFloat = progress * numLargeRocks;
            const index1 = Math.floor(innerIndexFloat);
            const index2 = (index1 + 1) % numLargeRocks;
            const lerpFactor = innerIndexFloat - index1;

            const data1 = innerContourData[index1];
            const data2 = innerContourData[index2];

            const basePosition = data1.position.clone().lerp(data2.position, lerpFactor);
            const baseNormal = data1.normal.clone().lerp(data2.normal, lerpFactor).normalize();

            const noiseProgress = progress * numSmallRocks;
            const noiseIndex1 = Math.floor(noiseProgress);
            const noiseIndex2 = (noiseIndex1 + 1) % numSmallRocks;
            const noiseLerpFactor = noiseProgress - noiseIndex1;
            const interpolatedNoise = THREE.MathUtils.lerp(smallNoise[noiseIndex1], smallNoise[noiseIndex2], noiseLerpFactor);

            const noisyOffset = shorelineOffset * (1 + interpolatedNoise * OFFSET_IRREGULARITY);

            const finalPosition = basePosition.clone().add(baseNormal.multiplyScalar(noisyOffset));
            finalPosition.y = getTerrainHeight(finalPosition.x, finalPosition.z, shorelineHeight);
            outerContourPoints.push(finalPosition);
        }

        const outerCurve = new THREE.CatmullRomCurve3(outerContourPoints, true);
        const outerCurvePoints = outerCurve.getPoints(256); // Even more points for a very smooth line

        const outerContourGeometry = new THREE.BufferGeometry().setFromPoints(outerCurvePoints);
        const outerContourMaterial = new THREE.LineBasicMaterial({ color: 0xff0000, linewidth: 2 });
        this.outerContourLine = new THREE.LineLoop(outerContourGeometry, outerContourMaterial);
        this.outerContourLine.visible = this.showOuterShorelineInput.checked;
        this.scene.add(this.outerContourLine);

        // --- Main Surface and Ground Cover Generation ---
        const topContourVertices = contourPointsForLine[contourPointsForLine.length - 1].equals(contourPointsForLine[0])
            ? contourPointsForLine.slice(0, -1)
            : contourPointsForLine;
            
        this.currentOuterFoliageBoundary = topContourVertices;

        if (topContourVertices.length > 2) {
            const centerXZ = new THREE.Vector2(0, 0);
            smoothedNoisePoints.forEach(p => centerXZ.add(new THREE.Vector2(p.x, p.z)));
            centerXZ.divideScalar(smoothedNoisePoints.length);
            
            const centerNoise = this.perlin.noise(centerXZ.x * noiseScale, centerXZ.y * noiseScale, 0);
            const centerHeight = baseHeight + centerNoise * noiseStrength;
            const centerPoint = new THREE.Vector3(centerXZ.x, centerHeight, centerXZ.y);

            const innerFoliageBoundaryPoints: THREE.Vector3[] = [];
            const offsetDistance = foliageBandWidth;

            for (let i = 0; i < contourPointsForLine.length; i++) {
                const p_curr = contourPointsForLine[i];
                const pointXZ = new THREE.Vector2(p_curr.x, p_curr.z);
                const direction = pointXZ.clone().sub(centerXZ);
                const originalDistance = direction.length();
                
                const newDistance = Math.max(0, originalDistance - offsetDistance);
                direction.normalize();
                
                const newPointXZ = centerXZ.clone().add(direction.multiplyScalar(newDistance));
                const heightLerpFactor = (originalDistance > 0.0001) ? (newDistance / originalDistance) : 0;
                const newY = THREE.MathUtils.lerp(centerPoint.y, p_curr.y, heightLerpFactor);
                
                innerFoliageBoundaryPoints.push(new THREE.Vector3(newPointXZ.x, newY, newPointXZ.y));
            }

            if (innerFoliageBoundaryPoints.length > 2) {
                const foliageBoundaryGeometry = new THREE.BufferGeometry().setFromPoints(innerFoliageBoundaryPoints);
                const foliageBoundaryMaterial = new THREE.LineBasicMaterial({ color: 0x34c759 }); // Green
                this.foliageBoundaryLine = new THREE.LineLoop(foliageBoundaryGeometry, foliageBoundaryMaterial);
                this.foliageBoundaryLine.visible = this.showFoliageBoundaryInput.checked;
                this.scene.add(this.foliageBoundaryLine);
                this.currentInnerFoliageBoundary = innerFoliageBoundaryPoints;
            }

            const allFeatures = [...this.lakes, ...this.mudPuddles];
            if (isRegeneration) {
                // On regeneration, clear generated properties but keep the center.
                // This allows them to be regenerated at the same spot on the new terrain.
                allFeatures.forEach(f => {
                    f.contourPoints = undefined;
                    f.avgRimHeight = undefined;
                    if (f.type === 'lake') {
                        (f as Lake).waterLevel = undefined;
                    }
                });
            }

            // Define the inner boundary curve for terrain generation and water level calculation
            const innerCurve = new THREE.CatmullRomCurve3(innerFoliageBoundaryPoints, true);
            const MESH_BOUNDARY_RESOLUTION = 256;
            const boundaryPoints = innerCurve.getPoints(MESH_BOUNDARY_RESOLUTION);
            const centralContourVertices = boundaryPoints.slice(0, -1);
            
            // Helper function to calculate the final blended terrain height at any XZ coordinate
            // before depressions are carved. This is crucial for calculating the correct water level.
            const getBaseTerrainHeightAt = (p: THREE.Vector2): number => {
                const angle = Math.atan2(p.y - centerXZ.y, p.x - centerXZ.x);
                const progress = (angle + Math.PI) / (2 * Math.PI);

                const numSegments = centralContourVertices.length;
                const floatIndex = progress * numSegments;
                const s1 = Math.floor(floatIndex);
                const s2 = (s1 + 1) % numSegments;
                const segmentLerp = floatIndex - s1;

                const edgePoint1 = centralContourVertices[s1];
                const edgePoint2 = centralContourVertices[s2];
                const edgePoint = new THREE.Vector3().lerpVectors(edgePoint1, edgePoint2, segmentLerp);
                
                const distToCenter = p.distanceTo(centerXZ);
                const distToEdge = new THREE.Vector2(edgePoint.x, edgePoint.z).distanceTo(centerXZ);

                if (distToEdge < 0.001) {
                    return edgePoint.y;
                }

                const radialLerp = Math.min(distToCenter / distToEdge, 1.0);
                
                // This easing and blending logic must match the main terrain generation loop precisely
                const t = radialLerp;
                const ringLerp = 1 - Math.pow(1 - t, 2);
                const blendFactor = Math.pow(ringLerp, 2);

                const perlinHeight = baseHeight + this.perlin.noise(p.x * noiseScale, p.y * noiseScale, 0) * noiseStrength;
                const interpolatedContourY = THREE.MathUtils.lerp(centerPoint.y, edgePoint.y, ringLerp);

                const finalY = THREE.MathUtils.lerp(perlinHeight, interpolatedContourY, blendFactor);
                return finalY;
            };


            if (this.currentInnerFoliageBoundary.length > 2) {
                const grassAreaBox = new THREE.Box2().setFromPoints(this.currentInnerFoliageBoundary.map(p => new THREE.Vector2(p.x, p.z)));
                
                // --- Part 1: Placement of NEW features (those with no center) ---
                allFeatures.forEach(feature => {
                    if (feature.center) return; // Skip if already placed

                    let center: THREE.Vector2 | null = null;

                    // Ensure features are placed away from the edge to not overlap non-deformable terrain
                    const maxIrregularity = feature.type === 'lake' ? 0.4 : 0.5;
                    const margin = feature.baseRadius * (1.0 + maxIrregularity);
                    const placementBox = grassAreaBox.clone().expandByScalar(-margin);

                    if (placementBox.isEmpty()) {
                        console.warn(`Cannot place feature id ${feature.id}, placement area is too small for its radius.`);
                        return;
                    }
                    
                    for (let attempt = 0; attempt < 200; attempt++) {
                        const randomCenter = new THREE.Vector2(
                            THREE.MathUtils.randFloat(placementBox.min.x, placementBox.max.x),
                            THREE.MathUtils.randFloat(placementBox.min.y, placementBox.max.y)
                        );
        
                        if (!this.isPointInPolygon(randomCenter, this.currentInnerFoliageBoundary)) continue;
                        
                        let tooClose = false;
                        for (const other of allFeatures) {
                            // Check against other features that have already been placed in this or previous runs
                            if (other.center && other.id !== feature.id) {
                                const requiredDist = (other.baseRadius || 0) + feature.baseRadius + 2.0;
                                if (randomCenter.distanceTo(other.center) < requiredDist) {
                                    tooClose = true;
                                    break;
                                }
                            }
                        }
                        if (tooClose) continue;
        
                        center = randomCenter;
                        break;
                    }

                    if (center) {
                        feature.center = center;
                    } else {
                        console.warn(`Could not place water feature id ${feature.id} with radius ${feature.baseRadius}`);
                    }
                });

                // --- Part 2: Generation of contours and levels for ALL features ---
                allFeatures.forEach(feature => {
                    // Only generate if we have a center but no contour points yet.
                    // This is true for both new features and old features during regeneration.
                    if (!feature.center || feature.contourPoints) return;

                    const isLake = feature.type === 'lake';
                    if (isLake) {
                        const numPoints = 32;
                        const irregularity = 0.4;
                        feature.irregularity = irregularity; 
                        const noise = this.generateNoise(numPoints, Math.random());
                        const contourPoints: THREE.Vector2[] = [];
                        for (let i = 0; i < numPoints; i++) {
                            const angle = (i / numPoints) * 2 * Math.PI;
                            const noisyRadius = feature.baseRadius * (1 + noise[i] * irregularity);
                            const x = feature.center!.x + Math.cos(angle) * noisyRadius;
                            const z = feature.center!.y + Math.sin(angle) * noisyRadius;
                            contourPoints.push(new THREE.Vector2(x, z));
                        }
                        feature.contourPoints = contourPoints;
                    } else { // Mud Puddle
                        const puddle = feature as MudPuddle;
                        if (!puddle.center || !puddle.noiseParams) return;

                        // Generate contour points for material assignment later
                        const numPoints = 200; // High resolution for smooth boundary
                        const contourPoints: THREE.Vector2[] = [];
                        for (let i = 0; i < numPoints; i++) {
                            const angle = (i / numPoints) * 2 * Math.PI;
                            
                            let noiseValue = 0;
                            for (const harmonic of puddle.noiseParams.harmonics) {
                                const phase = puddle.noiseParams.phaseOffset * harmonic.freq;
                                noiseValue += Math.sin(angle * harmonic.freq + phase) * harmonic.amp;
                            }
                            noiseValue /= puddle.noiseParams.totalAmplitude;
                            
                            const noisyRadius = puddle.baseRadius * (1 + noiseValue * (puddle.irregularity || 0.6));
                            const x = puddle.center.x + Math.cos(angle) * noisyRadius;
                            const z = puddle.center.y + Math.sin(angle) * noisyRadius;
                            contourPoints.push(new THREE.Vector2(x, z));
                        }
                        puddle.contourPoints = contourPoints;
                    }
    
                    let avgContourHeight = 0;
                    let count = 0;
                    for (const p of feature.contourPoints!) {
                        // Calculate the BLENDED terrain height at this contour point to ensure the
                        // water level matches the final terrain shape.
                        avgContourHeight += getBaseTerrainHeightAt(p);
                        count++;
                    }

                    if (count > 0) {
                        avgContourHeight /= count;
                        feature.avgRimHeight = avgContourHeight;

                        if (isLake) {
                            // Set water level slightly below the average rim height. A larger fraction of depth
                            // results in deeper-looking water with more pronounced shores.
                            (feature as Lake).waterLevel = avgContourHeight - (feature.depth * 0.2);
                        }
                    }
                });
            }

            const cliffEdgeCurve = new THREE.CatmullRomCurve3(topContourVertices, true);
            const shorelinePointsForMesh = cliffEdgeCurve.getPoints(MESH_BOUNDARY_RESOLUTION);

            let groundCoverGeometry: THREE.BufferGeometry | null = null;
            this.groundCoverMesh = null;
            this.islandSurface = null;

            if (boundaryPoints.length > 2 && shorelinePointsForMesh.length > 2) {
                const uniqueBoundaryPoints = boundaryPoints.slice(0, -1);
                const uniqueShorelinePoints = shorelinePointsForMesh.slice(0, -1);
                const numSegments = uniqueBoundaryPoints.length;

                if (numSegments > 0) {
                    const groundCoverVertices: number[] = [];
                    const groundCoverIndices: number[] = [];
                    const numRings = 32;
                    const gridIndices: number[][] = Array(numRings + 1).fill(0).map(() => Array(numSegments));
                    let vertexIndex = 0;

                    for (let r = 0; r <= numRings; r++) {
                        const ringLerp = r / numRings;
                        for (let s = 0; s < numSegments; s++) {
                            const outerPoint = uniqueShorelinePoints[s];
                            const innerPoint = uniqueBoundaryPoints[s];
                            const point = outerPoint.clone().lerp(innerPoint, ringLerp);
                            
                            groundCoverVertices.push(point.x, point.y, point.z);
                            gridIndices[r][s] = vertexIndex++;
                        }
                    }
                    const skirtBottomStartIndex = vertexIndex;
                    uniqueShorelinePoints.forEach(p => groundCoverVertices.push(p.x, 0, p.z));

                    for (let r = 0; r < numRings; r++) {
                        for (let s = 0; s < numSegments; s++) {
                            const next_s = (s + 1) % numSegments;
                            const i_tl = gridIndices[r][s], i_tr = gridIndices[r][next_s];
                            const i_bl = gridIndices[r + 1][s], i_br = gridIndices[r + 1][next_s];
                            groundCoverIndices.push(i_tl, i_bl, i_br);
                            groundCoverIndices.push(i_tl, i_br, i_tr);
                        }
                    }
                    for (let s = 0; s < numSegments; s++) {
                        const next_s = (s + 1) % numSegments;
                        const top_curr = gridIndices[0][s], top_next = gridIndices[0][next_s];
                        const bottom_curr = skirtBottomStartIndex + s, bottom_next = skirtBottomStartIndex + next_s;
                        groundCoverIndices.push(top_curr, top_next, bottom_next);
                        groundCoverIndices.push(top_curr, bottom_next, bottom_curr);
                    }
    
                    const geo = new THREE.BufferGeometry();
                    geo.setAttribute('position', new THREE.Float32BufferAttribute(groundCoverVertices, 3));
                    geo.setIndex(groundCoverIndices);
                    geo.computeVertexNormals();
    
                    const TEXTURE_SCALE = 20.0;
                    const groundCoverUVs: number[] = [];
                    const positions = geo.attributes.position.array;
                    for (let i = 0; i < positions.length / 3; i++) {
                        groundCoverUVs.push(positions[i * 3] / TEXTURE_SCALE, positions[i * 3 + 2] / TEXTURE_SCALE);
                    }
    
                    geo.setAttribute('uv', new THREE.Float32BufferAttribute(groundCoverUVs, 2));
                    geo.setAttribute('uv2', new THREE.Float32BufferAttribute(groundCoverUVs, 2));
                    this.groundCoverMaterial.side = THREE.DoubleSide;
                    groundCoverGeometry = geo;
                }
            }
            
            const vertices: number[] = [];
            const allCentralAreaIndices: number[] = [];
            const numSegments = centralContourVertices.length;
            const numRings = 240;
            let vertexIndex = 0;
            const gridIndices: number[][] = Array(numRings).fill(0).map(() => Array(numSegments));
            vertices.push(centerPoint.x, centerPoint.y, centerPoint.z);
            vertexIndex++;

            for (let r = 0; r < numRings; r++) {
                const t = (r + 1) / (numRings + 1);
                const ringLerp = 1 - Math.pow(1 - t, 2);
                for (let s = 0; s < numSegments; s++) {
                    const edgePoint = centralContourVertices[s];
                    const basePointXZ = new THREE.Vector2(centerPoint.x, centerPoint.z).lerp(new THREE.Vector2(edgePoint.x, edgePoint.z), ringLerp);
                    const noiseVal = this.perlin.noise(basePointXZ.x * noiseScale, basePointXZ.y * noiseScale, 0);
                    const pointY = baseHeight + noiseVal * noiseStrength;
                    const interpolatedContourY = THREE.MathUtils.lerp(centerPoint.y, edgePoint.y, ringLerp);
                    const blendFactor = Math.pow(ringLerp, 2);
                    let finalY = THREE.MathUtils.lerp(pointY, interpolatedContourY, blendFactor);
                    
                    this.lakes.forEach(lake => {
                        if (lake.contourPoints && lake.avgRimHeight !== undefined && this.isPointInPolygon2D(basePointXZ, lake.contourPoints)) {
                            const maxRadius = lake.baseRadius * (1.0 + (lake.irregularity || 0.4));
                            const influence = 1.0 - THREE.MathUtils.smoothstep(basePointXZ.distanceTo(lake.center!), 0, maxRadius);
                            const depressionDepth = lake.depth * influence;
                            const depressionCeiling = lake.avgRimHeight - depressionDepth;
                            finalY = Math.min(finalY, depressionCeiling);
                        }
                    });

                    this.mudPuddles.forEach(puddle => {
                        if (puddle.center && puddle.noiseParams && puddle.avgRimHeight !== undefined) {
                            const dx = basePointXZ.x - puddle.center.x;
                            const dz = basePointXZ.y - puddle.center.y;
                            const angle = Math.atan2(dz, dx);
                            const dist = Math.hypot(dx, dz);
                    
                            let noiseValue = 0;
                            for (const harmonic of puddle.noiseParams.harmonics) {
                                const phase = puddle.noiseParams.phaseOffset * harmonic.freq;
                                noiseValue += Math.sin(angle * harmonic.freq + phase) * harmonic.amp;
                            }
                            noiseValue /= puddle.noiseParams.totalAmplitude;
                            const boundaryDist = puddle.baseRadius * (1 + noiseValue * (puddle.irregularity || 0.6));
                            
                            if (dist < boundaryDist) {
                                const t_falloff = dist / boundaryDist;
                                const influence = 1 - (t_falloff * t_falloff * (3 - 2 * t_falloff)); // smoothstep falloff
                                const depressionDepth = puddle.depth * influence;
                                const depressionCeiling = puddle.avgRimHeight - depressionDepth;
                                finalY = Math.min(finalY, depressionCeiling);
                            }
                        }
                    });

                    vertices.push(basePointXZ.x, finalY, basePointXZ.y);
                    gridIndices[r][s] = vertexIndex++;
                }
            }

            const contourIndices: number[] = [];
            for(const p of centralContourVertices) {
                contourIndices.push(vertexIndex++);
                let finalY = p.y;
                const point2D = new THREE.Vector2(p.x, p.z);
                 this.lakes.forEach(lake => {
                    if (lake.contourPoints && lake.avgRimHeight !== undefined && this.isPointInPolygon2D(point2D, lake.contourPoints)) {
                        const maxRadius = lake.baseRadius * (1.0 + (lake.irregularity || 0.4));
                        const influence = 1.0 - THREE.MathUtils.smoothstep(point2D.distanceTo(lake.center!), 0, maxRadius);
                        const depressionDepth = lake.depth * influence;
                        const depressionCeiling = lake.avgRimHeight - depressionDepth;
                        finalY = Math.min(finalY, depressionCeiling);
                    }
                });
                this.mudPuddles.forEach(puddle => {
                    if (puddle.center && puddle.noiseParams && puddle.avgRimHeight !== undefined) {
                        const dx = point2D.x - puddle.center.x;
                        const dz = point2D.y - puddle.center.y;
                        const angle = Math.atan2(dz, dx);
                        const dist = Math.hypot(dx, dz);
                
                        let noiseValue = 0;
                        for (const harmonic of puddle.noiseParams.harmonics) {
                            const phase = puddle.noiseParams.phaseOffset * harmonic.freq;
                            noiseValue += Math.sin(angle * harmonic.freq + phase) * harmonic.amp;
                        }
                        noiseValue /= puddle.noiseParams.totalAmplitude;
                        const boundaryDist = puddle.baseRadius * (1 + noiseValue * (puddle.irregularity || 0.6));
                        
                        if (dist < boundaryDist) {
                            const t_falloff = dist / boundaryDist;
                            const influence = 1 - (t_falloff * t_falloff * (3 - 2 * t_falloff));
                            const depressionDepth = puddle.depth * influence;
                            const depressionCeiling = puddle.avgRimHeight - depressionDepth;
                            finalY = Math.min(finalY, depressionCeiling);
                        }
                    }
                });
                vertices.push(p.x, finalY, p.z);
            }
            
            for (let s = 0; s < numSegments; s++) {
                allCentralAreaIndices.push(0, gridIndices[0][s], gridIndices[0][(s + 1) % numSegments]);
            }
            for (let r = 0; r < numRings - 1; r++) {
                for (let s = 0; s < numSegments; s++) {
                    const next_s = (s + 1) % numSegments;
                    allCentralAreaIndices.push(gridIndices[r][s], gridIndices[r][next_s], gridIndices[r + 1][next_s]);
                    allCentralAreaIndices.push(gridIndices[r][s], gridIndices[r + 1][next_s], gridIndices[r + 1][s]);
                }
            }
            const lastRingIndex = numRings - 1;
            for (let s = 0; s < numSegments; s++) {
                const next_s = (s + 1) % numSegments;
                allCentralAreaIndices.push(gridIndices[lastRingIndex][s], gridIndices[lastRingIndex][next_s], contourIndices[next_s]);
                allCentralAreaIndices.push(gridIndices[lastRingIndex][s], contourIndices[next_s], contourIndices[s]);
            }
            
            // --- NEW: localized smoothing pass for lake depressions --------------------
            {
                const numVertices = vertices.length / 3;
                const heights = new Float32Array(numVertices);
                const positionsXZ = new Array<{x:number,z:number}>(numVertices);
                for (let i = 0; i < numVertices; i++) {
                    heights[i] = vertices[i*3 + 1];
                    positionsXZ[i] = { x: vertices[i*3], z: vertices[i*3 + 2] };
                }

                // adjacency
                const neighbors: Set<number>[] = Array.from({ length: numVertices }, () => new Set<number>());
                for (let i = 0; i < allCentralAreaIndices.length; i += 3) {
                    const a = allCentralAreaIndices[i], b = allCentralAreaIndices[i+1], c = allCentralAreaIndices[i+2];
                    neighbors[a].add(b); neighbors[a].add(c);
                    neighbors[b].add(a); neighbors[b].add(c);
                    neighbors[c].add(a); neighbors[c].add(b);
                }

                // compute influence per vertex (0..1) from any lake
                const influence = new Float32Array(numVertices);
                for (let vi = 0; vi < numVertices; vi++) {
                    let maxInf = 0;
                    const px = positionsXZ[vi].x, pz = positionsXZ[vi].z;
                    // Lakes
                    for (const lake of this.lakes) {
                        if (!lake.contourPoints || !lake.center) continue;
                        const maxRadius = lake.baseRadius * (1.0 + (lake.irregularity || 0.4));
                        const d = Math.hypot(px - lake.center.x, pz - lake.center.y);
                        if (d < maxRadius) {
                            const t = THREE.MathUtils.clamp(d / maxRadius, 0, 1);
                            const inf = 1 - (t * t * (3 - 2 * t));
                            maxInf = Math.max(maxInf, inf);
                        }
                    }
                    // Mud puddles
                    for (const puddle of this.mudPuddles) {
                        if (puddle.center && puddle.noiseParams) {
                            const dx = px - puddle.center.x;
                            const dz = pz - puddle.center.y;
                            const angle = Math.atan2(dz, dx);
                            const dist = Math.hypot(dx, dz);
                            
                            let noiseValue = 0;
                            for (const harmonic of puddle.noiseParams.harmonics) {
                                const phase = puddle.noiseParams.phaseOffset * harmonic.freq;
                                noiseValue += Math.sin(angle * harmonic.freq + phase) * harmonic.amp;
                            }
                            noiseValue /= puddle.noiseParams.totalAmplitude;
                            const boundaryDist = puddle.baseRadius * (1 + noiseValue * (puddle.irregularity || 0.6));

                            if (dist < boundaryDist) {
                                const t = dist / boundaryDist;
                                const inf = 1 - (t * t * (3 - 2 * t));
                                maxInf = Math.max(maxInf, inf);
                            }
                        }
                    }
                    influence[vi] = maxInf;
                }

                // build initial mask and dilate more to include a smooth transition ring
                const expandMask = new Uint8Array(numVertices);
                // For mud puddles, use a larger mask and more dilation for extra softness
                const mudInfluence = new Float32Array(numVertices);
                for (let i = 0; i < numVertices; i++) {
                    let mudInf = 0;
                    const px = positionsXZ[i].x, pz = positionsXZ[i].z;
                    for (const puddle of this.mudPuddles) {
                         if (puddle.center && puddle.noiseParams) {
                            const dx = px - puddle.center.x;
                            const dz = pz - puddle.center.y;
                            const angle = Math.atan2(dz, dx);
                            const dist = Math.hypot(dx, dz);
                            
                            let noiseValue = 0;
                            for (const harmonic of puddle.noiseParams.harmonics) {
                                const phase = puddle.noiseParams.phaseOffset * harmonic.freq;
                                noiseValue += Math.sin(angle * harmonic.freq + phase) * harmonic.amp;
                            }
                            noiseValue /= puddle.noiseParams.totalAmplitude;
                            const boundaryDist = puddle.baseRadius * (1 + noiseValue * (puddle.irregularity || 0.6));

                            if (dist < boundaryDist) {
                                const t = dist / boundaryDist;
                                const inf = 1 - (t * t * (3 - 2 * t));
                                mudInf = Math.max(mudInf, inf);
                            }
                        }
                    }
                    mudInfluence[i] = mudInf;
                }
                for (let i = 0; i < numVertices; i++) {
                    if (influence[i] > 0.001 || mudInfluence[i] > 0.001) expandMask[i] = 1;
                }
                // Dilate more for mud puddles (6 passes), otherwise 3 for lakes
                const dilationPasses = Math.max(3, this.mudPuddles.length > 0 ? 6 : 3);
                for (let pass = 0; pass < dilationPasses; pass++) {
                    const toSet: number[] = [];
                    for (let i = 0; i < numVertices; i++) {
                        if (expandMask[i]) {
                            neighbors[i].forEach(n => {
                                if (!expandMask[n]) toSet.push(n);
                            });
                        }
                    }
                    toSet.forEach(idx => expandMask[idx] = 1);
                }

                // Stage 1: Laplacian smoothing to remove sharp spikes
                // For mud puddles, use more smoothing iterations
                const STAGE1_ITER = this.mudPuddles.length > 0 ? 16 : 8;
                const tmpHeights = new Float32Array(numVertices);
                for (let it = 0; it < STAGE1_ITER; it++) {
                    tmpHeights.set(heights);
                    const iterFactor = 1.0 - (it / (STAGE1_ITER - 1)) * 0.5; // [0.5..1.0]
                    for (let vi = 0; vi < numVertices; vi++) {
                        if (!expandMask[vi]) continue;
                        let sum = 0, cnt = 0;
                        neighbors[vi].forEach(n => { sum += heights[n]; cnt++; });
                        if (cnt === 0) continue;
                        const neighAvg = sum / cnt;
                        const baseBlend = 0.6 * influence[vi]; // moderate blending
                        const blend = THREE.MathUtils.clamp(baseBlend * iterFactor, 0, 0.95);
                        tmpHeights[vi] = THREE.MathUtils.lerp(heights[vi], neighAvg, blend);
                    }
                    heights.set(tmpHeights);
                }

                // Stage 2: Radial target blending toward smooth crater profile
                // For each vertex, compute a desired height from all lakes (min across lakes),
                // using a smooth falloff profile; then blend toward that target.
                const radialTargets = new Float32Array(numVertices);
                radialTargets.set(heights); // default to current heights

                for (let vi = 0; vi < numVertices; vi++) {
                    let desired = heights[vi];
                    const px = positionsXZ[vi].x, pz = positionsXZ[vi].z;
                    // Lakes
                    for (const lake of this.lakes) {
                        if (!lake.contourPoints || lake.avgRimHeight === undefined || !lake.center) continue;
                        const maxRadius = lake.baseRadius * (1.0 + (lake.irregularity || 0.4));
                        const d = Math.hypot(px - lake.center.x, pz - lake.center.y);
                        if (d < maxRadius) {
                            const t = THREE.MathUtils.clamp(d / maxRadius, 0, 1);
                            const profile = 1 - (t * t * (3 - 2 * t));
                            const lakeTarget = lake.avgRimHeight - (lake.depth * profile);
                            desired = Math.min(desired, lakeTarget);
                        }
                    }
                    // Mud puddles
                    for (const puddle of this.mudPuddles) {
                        if (puddle.center && puddle.noiseParams && puddle.avgRimHeight !== undefined) {
                            const dx = px - puddle.center.x;
                            const dz = pz - puddle.center.y;
                            const angle = Math.atan2(dz, dx);
                            const dist = Math.hypot(dx, dz);
                            
                            let noiseValue = 0;
                            for (const harmonic of puddle.noiseParams.harmonics) {
                                const phase = puddle.noiseParams.phaseOffset * harmonic.freq;
                                noiseValue += Math.sin(angle * harmonic.freq + phase) * harmonic.amp;
                            }
                            noiseValue /= puddle.noiseParams.totalAmplitude;
                            const boundaryDist = puddle.baseRadius * (1 + noiseValue * (puddle.irregularity || 0.6));
                            
                            if (dist < boundaryDist) {
                                const t = dist / boundaryDist;
                                const profile = 1 - Math.pow(t, 1.5); // gentler profile
                                const puddleTarget = puddle.avgRimHeight - (puddle.depth * profile * 0.8);
                                desired = Math.min(desired, puddleTarget);
                            }
                        }
                    }
                    radialTargets[vi] = desired;
                }

                // Blend toward radial targets, weight by influence and mask
                for (let vi = 0; vi < numVertices; vi++) {
                    if (!expandMask[vi]) continue;
                    const inf = influence[vi];
                    const blend = THREE.MathUtils.clamp(inf * 0.85, 0, 0.98); // strong pull toward radial target
                    heights[vi] = THREE.MathUtils.lerp(heights[vi], radialTargets[vi], blend);
                }

                // Stage 3: small refinement Laplacian to remove any remaining artifacts
                const STAGE3_ITER = this.mudPuddles.length > 0 ? 12 : 6;
                for (let it = 0; it < STAGE3_ITER; it++) {
                    tmpHeights.set(heights);
                    const iterFactor = 0.6 + 0.4 * (1 - it / Math.max(1, STAGE3_ITER - 1)); // taper
                    for (let vi = 0; vi < numVertices; vi++) {
                        if (!expandMask[vi]) continue;
                        let sum = 0, cnt = 0;
                        neighbors[vi].forEach(n => { sum += heights[n]; cnt++; });
                        if (cnt === 0) continue;
                        const neighAvg = sum / cnt;
                        const baseBlend = 0.45 * influence[vi];
                        const blend = THREE.MathUtils.clamp(baseBlend * iterFactor, 0, 0.9);
                        tmpHeights[vi] = THREE.MathUtils.lerp(heights[vi], neighAvg, blend);
                    }
                    heights.set(tmpHeights);
                }

                // write back smoothed heights to vertices
                for (let i = 0; i < numVertices; i++) {
                    vertices[i*3 + 1] = heights[i];
                }
            }
            // --- END smoothing pass ---------------------------------------------------

            const grassAndMudGeometry = new THREE.BufferGeometry();
            grassAndMudGeometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
            grassAndMudGeometry.setIndex(allCentralAreaIndices);

            const grassIndicesFinal: number[] = [];
            const mudIndicesFinal: number[] = [];
            const positions = grassAndMudGeometry.attributes.position;
            const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3();
            const centroid = new THREE.Vector3(), centroid2D = new THREE.Vector2();

            for (let i = 0; i < allCentralAreaIndices.length; i += 3) {
                const iA = allCentralAreaIndices[i], iB = allCentralAreaIndices[i+1], iC = allCentralAreaIndices[i+2];
                vA.fromBufferAttribute(positions, iA);
                vB.fromBufferAttribute(positions, iB);
                vC.fromBufferAttribute(positions, iC);
                centroid.copy(vA).add(vB).add(vC).divideScalar(3);
                centroid2D.set(centroid.x, centroid.z);

                let isMud = false;
                for (const puddle of this.mudPuddles) {
                    if (puddle.contourPoints && this.isPointInPolygon2D(centroid2D, puddle.contourPoints)) {
                        isMud = true;
                        break;
                    }
                }

                if (isMud) {
                    mudIndicesFinal.push(iA, iB, iC);
                } else {
                    grassIndicesFinal.push(iA, iB, iC);
                }
            }
            
            grassAndMudGeometry.setIndex(null); // Clear old index

            const TEXTURE_SCALE = 20.0;
            const uvs: number[] = [];
            const grassPositions = grassAndMudGeometry.attributes.position.array;
            for (let i = 0; i < grassPositions.length / 3; i++) {
                uvs.push(grassPositions[i * 3] / TEXTURE_SCALE, grassPositions[i * 3 + 2] / TEXTURE_SCALE);
            }
            grassAndMudGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
            grassAndMudGeometry.setAttribute('uv2', new THREE.Float32BufferAttribute(uvs, 2));

            if (groundCoverGeometry) {
                const groundGeo = groundCoverGeometry;
                const grassGeo = grassAndMudGeometry;

                const groundPositions = groundGeo.attributes.position.array as Float32Array;
                const groundUvs = groundGeo.attributes.uv.array as Float32Array;
                const groundIndices = groundGeo.index!.array as Uint16Array | Uint32Array;

                const grassPositions = grassGeo.attributes.position.array as Float32Array;
                const grassUvs = grassGeo.attributes.uv.array as Float32Array;

                const mergedPositions = new Float32Array(groundPositions.length + grassPositions.length);
                mergedPositions.set(groundPositions, 0);
                mergedPositions.set(grassPositions, groundPositions.length);

                const mergedUvs = new Float32Array(groundUvs.length + grassUvs.length);
                mergedUvs.set(groundUvs, 0);
                mergedUvs.set(grassUvs, groundUvs.length);
                
                const vertexOffset = groundPositions.length / 3;
                const grassIndicesOffset = grassIndicesFinal.map(i => i + vertexOffset);
                const mudIndicesOffset = mudIndicesFinal.map(i => i + vertexOffset);

                const mergedIndices = new Uint32Array(groundIndices.length + grassIndicesOffset.length + mudIndicesOffset.length);
                mergedIndices.set(groundIndices, 0);
                mergedIndices.set(grassIndicesOffset, groundIndices.length);
                mergedIndices.set(mudIndicesOffset, groundIndices.length + grassIndicesOffset.length);

                const mergedGeometry = new THREE.BufferGeometry();
                mergedGeometry.setAttribute('position', new THREE.BufferAttribute(mergedPositions, 3));
                mergedGeometry.setAttribute('uv', new THREE.BufferAttribute(mergedUvs, 2));
                mergedGeometry.setAttribute('uv2', new THREE.BufferAttribute(mergedUvs, 2));
                mergedGeometry.setIndex(new THREE.BufferAttribute(mergedIndices, 1));

                mergedGeometry.addGroup(0, groundIndices.length, 0); // Ground Cover
                const grassStart = groundIndices.length;
                mergedGeometry.addGroup(grassStart, grassIndicesOffset.length, 1); // Grass
                const mudStart = grassStart + grassIndicesOffset.length;
                mergedGeometry.addGroup(mudStart, mudIndicesOffset.length, 2); // Mud

                mergedGeometry.computeVertexNormals();
                mergedGeometry.computeTangents();

                const terrainMesh = new THREE.Mesh(mergedGeometry, [this.groundCoverMaterial, this.grassMaterial, this.mudMaterial]);
                this.group.add(terrainMesh);
                
                this.groundCoverMesh = terrainMesh;
                this.islandSurface = terrainMesh;
            } else {
                grassAndMudGeometry.setIndex([...grassIndicesFinal, ...mudIndicesFinal]);
                grassAndMudGeometry.addGroup(0, grassIndicesFinal.length, 0);
                grassAndMudGeometry.addGroup(grassIndicesFinal.length, mudIndicesFinal.length, 1);
                grassAndMudGeometry.computeVertexNormals();
                grassAndMudGeometry.computeTangents();
                this.islandSurface = new THREE.Mesh(grassAndMudGeometry, [this.grassMaterial, this.mudMaterial]);
                this.group.add(this.islandSurface);
            }

            this.generatePathButton.disabled = false;
            this.generateFoliage(contourPointsForLine, innerFoliageBoundaryPoints, this.islandSurface);
            this.generateWaterAndMudFeatures();
        }

        const geometry = new THREE.BufferGeometry().setFromPoints(contourPointsForLine);
        const material = new THREE.LineBasicMaterial({ color: 0x00ffff, linewidth: 2 });
        this.contourLine = new THREE.LineLoop(geometry, material);
        this.contourLine.visible = this.showCliffEdgeInput.checked;
        this.scene.add(this.contourLine);
        
        this.controls.target.set(0, maxSurfaceY / 2, 0);

        const tanFovY2 = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
        const tanFovX2 = tanFovY2 * this.camera.aspect;

        const islandDiameter = (baseRadius + shorelineOffset) * 2;
        const distForWidth = islandDiameter / (2 * tanFovX2);
        const distForDepth = islandDiameter / (2 * tanFovY2);
        const cameraZ = Math.max(distForWidth, distForDepth) * 1.4;

        this.camera.position.set(0, cameraZ * 0.5, cameraZ);
        this.controls.update();

    } catch(e) {
        console.error("Failed to generate island:", e);
        alert("An error occurred during generation. Please check the console.");
    } finally {
        this.showLoading(false);
        this.generateButton.disabled = this.rockModels.length === 0;
    }
  }

  private isPointInPolygon(point: THREE.Vector2, polygon: THREE.Vector3[]): boolean {
    let isInside = false;
    const x = point.x, y = point.y;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].x, zi = polygon[i].z;
        const xj = polygon[j].x, zj = polygon[j].z;

        const intersect = ((zi > y) !== (zj > y))
            && (x < (xj - xi) * (y - zi) / (zj - zi) + xi);
        if (intersect) isInside = !isInside;
    }
    return isInside;
  }
  
  private isPointInPolygon2D(point: THREE.Vector2, polygon: THREE.Vector2[]): boolean {
    let isInside = false;
    const x = point.x, y = point.y;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].x, yi = polygon[i].y;
        const xj = polygon[j].x, yj = polygon[j].y;

        const intersect = ((yi > y) !== (yj > y))
            && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) isInside = !isInside;
    }
    return isInside;
  }
    
    // =================================================================================
    // PATH GENERATION
                                                                                                                                                                                                                                                                
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                
                                                                                                                                        

                                    
                                     // =================================================================================
    
    private createSurfacePath(
        startPoint: THREE.Vector3,
        endPoint: THREE.Vector3,
        targetMesh: THREE.Mesh,
        raycaster: THREE.Raycaster,
        down: THREE.Vector3,
        stepLength: number
    ): { path: THREE.Vector3[], normals: THREE.Vector3[] } {
        const path: THREE.Vector3[] = [startPoint.clone()];
        const normals: THREE.Vector3[] = [];
        
        raycaster.set(startPoint.clone().add(new THREE.Vector3(0, 10, 0)), down);
        let intersect = raycaster.intersectObject(targetMesh, true);
        normals.push(intersect.length > 0 && intersect[0].face ? intersect[0].face.normal.clone() : new THREE.Vector3(0, 1, 0));
        
        const totalDistance = startPoint.distanceTo(endPoint);
        const numSteps = Math.ceil(totalDistance / stepLength);
        
        if (numSteps <= 1) {
            path.push(endPoint.clone());
            raycaster.set(endPoint.clone().add(new THREE.Vector3(0, 10, 0)), down);
            intersect = raycaster.intersectObject(targetMesh, true);
            normals.push(intersect.length > 0 && intersect[0].face ? intersect[0].face.normal.clone() : new THREE.Vector3(0, 1, 0));
            return { path, normals };
        }
    
        const direction = endPoint.clone().sub(startPoint).normalize();
    
        for (let i = 1; i <= numSteps; i++) {
            const distanceAlong = Math.min(stepLength * i, totalDistance);
            const nextPointXZ = startPoint.clone().add(direction.clone().multiplyScalar(distanceAlong));
            nextPointXZ.y = 100; // High up for raycasting
    
            raycaster.set(nextPointXZ, down);
            intersect = raycaster.intersectObject(targetMesh, true);
    
            if (intersect.length > 0) {
                if (path[path.length - 1].distanceToSquared(intersect[0].point) > 0.001) {
                    path.push(intersect[0].point);
                    normals.push(intersect[0].face ? intersect[0].face.normal.clone() : new THREE.Vector3(0, 1, 0));
                }
            } else {
                break;
            }
        }
    
        if (path[path.length - 1].distanceToSquared(endPoint) > 0.001) {
            path.push(endPoint.clone());
            raycaster.set(endPoint.clone().add(new THREE.Vector3(0, 10, 0)), down);
            intersect = raycaster.intersectObject(targetMesh, true);
            normals.push(intersect.length > 0 && intersect[0].face ? intersect[0].face.normal.clone() : new THREE.Vector3(0, 1, 0));
        }
        
        return { path, normals };
    }

    private smoothAndProjectPath(
        rawPath: THREE.Vector3[],
        divisions: number,
        targetMesh: THREE.Mesh,
        raycaster: THREE.Raycaster,
        down: THREE.Vector3
    ): { path: THREE.Vector3[], normals: THREE.Vector3[] } {
        if (rawPath.length < 3) {
            // Not enough points to smooth, just project and return
            return this.projectPathToSurface(rawPath, targetMesh, raycaster, down);
        }

        // 1. Create Catmull-Rom spline
        const curve = new THREE.CatmullRomCurve3(rawPath, false, 'catmullrom', 0.5);

        // 2. Sample along the curve
        const smoothedPoints: THREE.Vector3[] = [];
        for (let i = 0; i <= divisions; i++) {
            smoothedPoints.push(curve.getPoint(i / divisions));
        }

        // 3. Project each sample to mesh surface and collect normals
        return this.projectPathToSurface(smoothedPoints, targetMesh, raycaster, down);
    }

    private projectPathToSurface(
        points: THREE.Vector3[],
        targetMesh: THREE.Mesh,
        raycaster: THREE.Raycaster,
        down: THREE.Vector3
    ): { path: THREE.Vector3[], normals: THREE.Vector3[] } {
        const projected: THREE.Vector3[] = [];
        const normals: THREE.Vector3[] = [];
        for (const p of points) {
            raycaster.set(p.clone().add(new THREE.Vector3(0, 10, 0)), down);
            const intersect = raycaster.intersectObject(targetMesh, true);
            if (intersect.length > 0 && intersect[0].point) {
                projected.push(intersect[0].point.clone());
                normals.push(intersect[0].face?.normal.clone() ?? new THREE.Vector3(0, 1, 0));
            }
        }
        return { path: projected, normals };
    }


    private createPathRibbon(path3D: THREE.Vector3[], pathNormals: THREE.Vector3[], pathWidth: number, material: THREE.Material, yOffset: number = 0.05) {
        if (path3D.length < 2) return null;
        const vertices: number[] = [];
        const normals: number[] = [];
        const uvs: number[] = [];
        const indices: number[] = [];
        let pathLength = 0;

        for (let k = 0; k < path3D.length; k++) {
            const point = path3D[k];
            const surfaceNormal = pathNormals[k];
            let direction = new THREE.Vector3();

            if (k < path3D.length - 1) {
                direction.subVectors(path3D[k + 1], point);
            } else {
                direction.subVectors(point, path3D[k - 1]);
            }
            direction.normalize();

            const right = new THREE.Vector3().crossVectors(direction, surfaceNormal).normalize();
            const leftPoint = new THREE.Vector3().subVectors(point, right.clone().multiplyScalar(pathWidth / 2));
            const rightPoint = new THREE.Vector3().addVectors(point, right.clone().multiplyScalar(pathWidth / 2));

            vertices.push(leftPoint.x, leftPoint.y + yOffset, leftPoint.z);
            vertices.push(rightPoint.x, rightPoint.y + yOffset, rightPoint.z);
            
            normals.push(surfaceNormal.x, surfaceNormal.y, surfaceNormal.z);
            normals.push(surfaceNormal.x, surfaceNormal.y, surfaceNormal.z);
            
            if (k > 0) {
                pathLength += path3D[k].distanceTo(path3D[k - 1]);
            }
            uvs.push(0, pathLength / pathWidth); // U is 0 for left edge
            uvs.push(1, pathLength / pathWidth); // U is 1 for right edge
        }
        
        for (let k = 0; k < path3D.length - 1; k++) {
            const tl = k * 2;
            const tr = k * 2 + 1;
            const bl = k * 2 + 2;
            const br = k * 2 + 3;
            indices.push(tl, bl, tr);
            indices.push(tr, bl, br);
        }

        if (vertices.length > 0 && indices.length > 0) {
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
            geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
            geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
            geometry.setIndex(indices);
            
            const pathMesh = new THREE.Mesh(geometry, material);
            return pathMesh;
        }
        return null;
    }
    
    private delaunayTriangulation(points: Vertex2D[]): Triangle2D[] {
        const epsilon = 1e-6;
    
        // 1. Create a bounding box and a super-triangle
        let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
        points.forEach(p => {
            minX = Math.min(minX, p.x);
            minZ = Math.min(minZ, p.z);
            maxX = Math.max(maxX, p.x);
            maxZ = Math.max(maxZ, p.z);
        });
    
        const dx = maxX - minX;
        const dz = maxZ - minZ;
        const deltaMax = Math.max(dx, dz);
        const midX = minX + dx * 0.5;
        const midZ = minZ + dz * 0.5;
    
        const p0 = { x: midX - 20 * deltaMax, z: midZ - deltaMax, originalIndex: -1 };
        const p1 = { x: midX, z: midZ + 20 * deltaMax, originalIndex: -1 };
        const p2 = { x: midX + 20 * deltaMax, z: midZ - deltaMax, originalIndex: -1 };
        
        let triangles: Triangle2D[] = [{ v0: p0, v1: p1, v2: p2 }];
    
        // 2. Add points one by one
        points.forEach(point => {
            const badTriangles: Triangle2D[] = [];
            const polygon: Edge2D[] = [];
    
            // Find bad triangles
            triangles.forEach(triangle => {
                if (!triangle.circumcircle) {
                    const ax = triangle.v0.x, az = triangle.v0.z;
                    const bx = triangle.v1.x, bz = triangle.v1.z;
                    const cx = triangle.v2.x, cz = triangle.v2.z;
                    const D = 2 * (ax * (bz - cz) + bx * (cz - az) + cx * (az - bz));
                    const ux = ((ax * ax + az * az) * (bz - cz) + (bx * bx + bz * bz) * (cz - az) + (cx * cx + cz * cz) * (az - bz)) / D;
                    const uz = ((ax * ax + az * az) * (cx - bx) + (bx * bx + bz * bz) * (ax - cx) + (cx * cx + cz * cz) * (bx - ax)) / D;
                    const radiusSq = (ax - ux) ** 2 + (az - uz) ** 2;
                    triangle.circumcircle = { x: ux, z: uz, radiusSq };
                }
    
                const distSq = (point.x - triangle.circumcircle.x) ** 2 + (point.z - triangle.circumcircle.z) ** 2;
                if (distSq < triangle.circumcircle.radiusSq) {
                    badTriangles.push(triangle);
                }
            });
    
            // Find the boundary of the polygon hole
            badTriangles.forEach((triangle, i) => {
                const edges: Edge2D[] = [{ v0: triangle.v0, v1: triangle.v1 }, { v0: triangle.v1, v1: triangle.v2 }, { v0: triangle.v2, v1: triangle.v0 }];
                edges.forEach(edge => {
                    let isShared = false;
                    for (let j = 0; j < badTriangles.length; j++) {
                        if (i === j) continue;
                        const other = badTriangles[j];
                        const otherEdges: Edge2D[] = [{ v0: other.v0, v1: other.v1 }, { v0: other.v1, v1: other.v2 }, { v0: other.v2, v1: other.v0 }];
                        if (otherEdges.some(otherEdge =>
                            (edge.v0 === otherEdge.v0 && edge.v1 === otherEdge.v1) || (edge.v0 === otherEdge.v1 && edge.v1 === otherEdge.v0))) {
                            isShared = true;
                            break;
                        }
                    }
                    if (!isShared) {
                        polygon.push(edge);
                    }
                });
            });
    
            // Remove bad triangles and re-triangulate the hole
            triangles = triangles.filter(t => !badTriangles.includes(t));
            polygon.forEach(edge => {
                triangles.push({ v0: edge.v0, v1: edge.v1, v2: point });
            });
        });
    
        // 3. Remove triangles connected to the super-triangle
        return triangles.filter(t => !(t.v0.originalIndex === -1 || t.v1.originalIndex === -1 || t.v2.originalIndex === -1));
    }


    private generateGraphPaths() {
        if (!this.islandSurface) {
            alert("Please generate an island first before generating paths.");
            return;
        }
        if (!this.pathToggleInput.checked || this.currentInnerFoliageBoundary.length < 3) {
            return;
        }
    
        this.showLoading(true, "Generating paths...");
        this.pathGroup.clear();
    
        const numPoints = parseInt(this.pathPointsInput.value, 10);
        const loopPercentage = parseInt(this.pathLoopingInput.value, 10) / 100.0;
        const pathWidth = parseFloat(this.pathWidthInput.value);
    
        if (numPoints < 3) {
            this.showLoading(false);
            return;
        }
    
        const raycaster = new THREE.Raycaster();
        const down = new THREE.Vector3(0, -1, 0);
        
        const nodes: THREE.Vector3[] = [];
        const pathAreaBox = new THREE.Box3().setFromPoints(this.currentInnerFoliageBoundary);
        const maxAttempts = numPoints * 100;
        let attempts = 0;

        // Helper: check if a point is inside any lake
        const isInLake = (x: number, z: number): boolean => {
            for (const lake of this.lakes) {
                if (lake.contourPoints && this.isPointInPolygon2D(new THREE.Vector2(x, z), lake.contourPoints)) {
                    return true;
                }
            }
            return false;
        };
        
        while (nodes.length < numPoints && attempts < maxAttempts) {
            const randomX = THREE.MathUtils.randFloat(pathAreaBox.min.x, pathAreaBox.max.x);
            const randomZ = THREE.MathUtils.randFloat(pathAreaBox.min.z, pathAreaBox.max.z);
            const testPoint2D = new THREE.Vector2(randomX, randomZ);

            // Don't place nodes inside lakes
            if (this.isPointInPolygon(testPoint2D, this.currentInnerFoliageBoundary) && !isInLake(randomX, randomZ)) {
                raycaster.set(new THREE.Vector3(randomX, pathAreaBox.max.y + 100, randomZ), down);
                const intersects = raycaster.intersectObject(this.islandSurface, true);
                if (intersects.length > 0) {
                    nodes.push(intersects[0].point);
                }
            }
            attempts++;
        }
    
        if (nodes.length < 3) {
            console.warn("Not enough nodes placed for path generation.");
            this.showLoading(false);
            return;
        }

        const vertices2D: Vertex2D[] = nodes.map((n, i) => ({ x: n.x, z: n.z, originalIndex: i }));
        const triangles = this.delaunayTriangulation(vertices2D);
    
        const allEdges: { u: number, v: number, weight: number }[] = [];
        const edgeSet = new Set<string>();
        triangles.forEach(tri => {
            const edges: [Vertex2D, Vertex2D][] = [[tri.v0, tri.v1], [tri.v1, tri.v2], [tri.v2, tri.v0]];
            edges.forEach(edge => {
                const u = edge[0].originalIndex;
                const v = edge[1].originalIndex;
                const key = `${Math.min(u,v)},${Math.max(u,v)}`;
                if (!edgeSet.has(key)) {
                    const p1 = nodes[u];
                    const p2 = nodes[v];
                    // Disallow edges that cross a lake
                    let crossesLake = false;
                    for (const lake of this.lakes) {
                        if (lake.contourPoints) {
                            // Check midpoint and endpoints for being inside the lake
                            const mid = new THREE.Vector2((p1.x + p2.x) / 2, (p1.z + p2.z) / 2);
                            if (
                                this.isPointInPolygon2D(new THREE.Vector2(p1.x, p1.z), lake.contourPoints) ||
                                this.isPointInPolygon2D(new THREE.Vector2(p2.x, p2.z), lake.contourPoints) ||
                                this.isPointInPolygon2D(mid, lake.contourPoints)
                            ) {
                                crossesLake = true;
                                break;
                            }
                        }
                    }
                    if (!crossesLake) {
                        const weight = p1.distanceToSquared(p2);
                        allEdges.push({ u, v, weight });
                        edgeSet.add(key);
                    }
                }
            });
        });

        allEdges.sort((a, b) => a.weight - b.weight);

        const mstEdges: { u: number, v: number }[] = [];
        const remainingEdges: { u: number, v: number }[] = [];
        const uf = new UnionFind(nodes.length);
        
        allEdges.forEach(edge => {
            if (uf.find(edge.u) !== uf.find(edge.v)) {
                uf.union(edge.u, edge.v);
                mstEdges.push({ u: edge.u, v: edge.v });
            } else {
                remainingEdges.push({ u: edge.u, v: edge.v });
            }
        });

        remainingEdges.sort(() => Math.random() - 0.5);
        const numLoopsToAdd = Math.floor(remainingEdges.length * loopPercentage);
        const loops = remainingEdges.slice(0, numLoopsToAdd);

        const finalEdges = [...mstEdges, ...loops];

        finalEdges.forEach(edge => {
            const startNode = nodes[edge.u];
            const endNode = nodes[edge.v];

            // Before generating a path, check if the straight line crosses a lake
            let crossesLake = false;
            for (const lake of this.lakes) {
                if (lake.contourPoints) {
                    // Sample points along the edge and check if any are inside a lake
                    for (let t = 0; t < 1.0; t += 0.1) {
                        const x = THREE.MathUtils.lerp(startNode.x, endNode.x, t);
                        const z = THREE.MathUtils.lerp(startNode.z, endNode.z, t);
                        if (this.isPointInPolygon2D(new THREE.Vector2(x, z), lake.contourPoints)) {
                            crossesLake = true;
                            break;
                        }
                    }
                    if (crossesLake) break;
                }
            }
            if (crossesLake) return;

            // Step 1: Generate a raw, jagged path on the surface.
            const { path: rawPath } = this.createSurfacePath(startNode, endNode, this.islandSurface!, raycaster, down, 1.0); // Use a smaller step length for more detail

            // Remove path segments that cross a lake
            let valid = true;
            for (const p of rawPath) {
                for (const lake of this.lakes) {
                    if (lake.contourPoints && this.isPointInPolygon2D(new THREE.Vector2(p.x, p.z), lake.contourPoints)) {
                        valid = false;
                        break;
                    }
                }
                if (!valid) break;
            }
            if (!valid) return;

            if (rawPath.length >= 2) {
                // Step 2: Smooth this path.
                const divisions = rawPath.length * 2;
                const { path, normals } = this.smoothAndProjectPath(rawPath, divisions, this.islandSurface!, raycaster, down);

                // Step 3: Create ribbon from the smoothed path.
                if (path.length >= 2) {
                    const pathMesh = this.createPathRibbon(path, normals, pathWidth, this.pathMaterial);
                    if (pathMesh) {
                        this.pathGroup.add(pathMesh);
                    }
                }
            }
        });
        this.showLoading(false);
    }
    
    // =================================================================================
    // WATER & MUD FEATURES
    // =================================================================================

    private generateWaterAndMudFeatures() {
        if (!this.islandSurface) return;

        // Helper to get terrain height at (x, z)
        const getTerrainHeightAt = (x: number, z: number): number => {
            const raycaster = new THREE.Raycaster();
            raycaster.set(new THREE.Vector3(x, 100, z), new THREE.Vector3(0, -1, 0));
            const intersects = raycaster.intersectObject(this.islandSurface!, true);
            if (intersects.length > 0) {
                return intersects[0].point.y;
            }
            return 0;
        };

        // Helper: check if a point is inside the green area (inner foliage boundary)
        const isInGreenArea = (x: number, z: number): boolean => {
            if (!this.currentInnerFoliageBoundary || this.currentInnerFoliageBoundary.length < 3) return false;
            const pt = new THREE.Vector2(x, z);
            let inside = false;
            const verts = this.currentInnerFoliageBoundary;
            for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
                const xi = verts[i].x, zi = verts[i].z;
                const xj = verts[j].x, zj = verts[j].z;
                if (((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) {
                    inside = !inside;
                }
            }
            return inside;
        };

        // Atomically clear and dispose old features
        this.waterGroup.traverse(child => {
            if (child instanceof THREE.Mesh) {
                child.geometry.dispose();
            }
        });
        this.waterGroup.clear();

        // Generate lakes if the feature is enabled
        if (this.waterFeaturesToggle.checked) {
            this.lakes.forEach(lake => {
                if (lake.contourPoints && lake.avgRimHeight !== undefined) {
                    // Place the lake surface slightly below the rim (lowered a bit)
                    const lakeSurfaceOffset = -0.40; // Lowered further below the rim
                    const expandFactor = 1.10; // 10% outward expansion

                    // Expand the contour outward from the center
                    const center = lake.center!;
                    const expandedContour = lake.contourPoints.map(p => {
                        const dir = new THREE.Vector2(p.x - center.x, p.y - center.y);
                        return new THREE.Vector2(
                            center.x + dir.x * expandFactor,
                            center.y + dir.y * expandFactor
                        );
                    });

                    // Filter out points outside the green area
                    const filteredContour = expandedContour.filter(v => isInGreenArea(v.x, v.y));
                    if (filteredContour.length < 3) return;

                    const triangles = THREE.ShapeUtils.triangulateShape(filteredContour, []);
                    const vertices: number[] = [];
                    filteredContour.forEach(v => {
                        vertices.push(v.x, lake.avgRimHeight! + lakeSurfaceOffset, v.y);
                    });
                    const indices: number[] = [];
                    triangles.forEach(tri => {
                        indices.push(tri[0], tri[1], tri[2]);
                    });
                    const geo = new THREE.BufferGeometry();
                    geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
                    geo.setIndex(indices);
                    geo.computeVertexNormals();
                    const lakeMesh = new THREE.Mesh(geo, this.waterMaterial);
                    this.waterGroup.add(lakeMesh);
                }
            });
        }
        // Mud puddles are now part of the main terrain mesh and don't need a separate mesh.
    }

    private async regenerateTerrainAndWater() {
        if (this.rockModels.length === 0) {
            console.warn("Cannot regenerate, no rock models loaded.");
            return;
        }
        
        this.showLoading(true, "Updating terrain...");
        await new Promise(resolve => setTimeout(resolve, 20));

        try {
            await this.generateIsland(true);

        } catch(e) {
            console.error("Failed to regenerate terrain:", e);
        } finally {
            this.showLoading(false);
        }
    }

    private async handleAddLake() {
        this.lakes.push({
            type: 'lake',
            id: Math.random(),
            baseRadius: parseFloat(this.lakeRadiusInput.value),
            depth: parseFloat(this.lakeDepthInput.value),
        });
        if (this.rockModels.length > 0) {
            await this.regenerateTerrainAndWater();
        }
    }
    
    private async handleDeleteLastLake() {
        if (this.lakes.length > 0) {
            this.lakes.pop();
            await this.regenerateTerrainAndWater();
        }
    }
    
    private async handleAddMudPuddle() {
        const puddleHarmonics = [
            { freq: 6, amp: 1.0 },   // A single sine wave for a more regular, wavy pattern
        ];
        const totalAmplitude = puddleHarmonics.reduce((sum, h) => sum + h.amp, 0);
    
        this.mudPuddles.push({
            type: 'mud_puddle',
            id: Math.random(),
            baseRadius: parseFloat(this.mudPuddleRadiusInput.value),
            depth: 0.5,
            irregularity: 0.15, // Lowered to make the sine wave shape more pronounced
            noiseParams: {
                harmonics: puddleHarmonics,
                phaseOffset: Math.random() * 2 * Math.PI,
                totalAmplitude: totalAmplitude
            }
        });
        if (this.rockModels.length > 0) {
            await this.regenerateTerrainAndWater();
        }
    }

    private async handleDeleteLastMudPuddle() {
        if (this.mudPuddles.length > 0) {
            this.mudPuddles.pop();
            await this.regenerateTerrainAndWater();
        }
    }

  private generateFoliage(
    outerBoundary: THREE.Vector3[],
    innerBoundary: THREE.Vector3[],
    targetMesh: THREE.Mesh | null
  ) {
    this.showLoading(true, "Placing foliage...");
    
    setTimeout(() => {
        if (!targetMesh || this.foliageModels.length === 0) {
            if (this.foliageCoordinatesList) {
                this.foliageCoordinatesList.textContent = 'No foliage models loaded or no surface to place them on.';
            }
            this.showLoading(false);
            return;
        }

        try {
            this.foliageGroup.clear();
            
            this.placeFoliageOnMesh({
                targetMesh: targetMesh,
                models: this.foliageModels,
                densityInput: this.foliageDensityInput,
                maxCountInput: this.maxFoliageCountInput,
                maxSlopeInput: this.maxFoliageSlopeInput,
                scaleInput: this.foliageScaleInput,
                outerBoundary: outerBoundary,
                innerBoundary: innerBoundary,
                foliageBandWidth: parseFloat(this.foliageBandWidthInput.value),
                debugLabel: 'Foliage',
                outputElement: this.foliageCoordinatesList,
            });
        } catch (e) {
            console.error("Failed to place foliage:", e);
            alert("An error occurred during foliage placement. Please check console.");
            if (this.foliageCoordinatesList) this.foliageCoordinatesList.textContent = 'Error generating foliage.';
        } finally {
            this.showLoading(false);
        }
    }, 20);
  }

  private placeFoliageOnMesh(options: PlaceFoliageOptions) {
    const { targetMesh, models, densityInput, maxCountInput, maxSlopeInput, scaleInput, outerBoundary, innerBoundary, foliageBandWidth, debugLabel, outputElement } = options;

    const geometry = targetMesh.geometry;
    const positions = geometry.attributes.position;
    if (!geometry.index) {
        console.error(`${debugLabel}: Target mesh is non-indexed. Skipping foliage placement.`);
        if (outputElement) outputElement.textContent = `Error: ${debugLabel} mesh has no index. Cannot place foliage.`;
        return;
    }
    const indices = geometry.index.array;
    
    const maxSlopeDegrees = parseFloat(maxSlopeInput.value);
    const slopeThreshold = Math.cos(THREE.MathUtils.degToRad(maxSlopeDegrees));

    const debugStats = {
        totalFaces: indices.length / 3,
        rejectedSlope: 0,
        rejectedSubmerged: 0,
        rejectedOutsideBand: 0,
        rejectedInsideBand: 0,
        accepted: 0
    };
    
    const validFaces: {
        vA: THREE.Vector3,
        vB: THREE.Vector3,
        vC: THREE.Vector3,
        normal: THREE.Vector3,
        area: number
    }[] = [];
    let totalArea = 0;

    const vA = new THREE.Vector3();
    const vB = new THREE.Vector3();
    const vC = new THREE.Vector3();
    const triangle = new THREE.Triangle();
    const centroid = new THREE.Vector3();
    const centroid2D = new THREE.Vector2();
    const faceNormal = new THREE.Vector3();

    for (let i = 0; i < indices.length; i += 3) {
        const iA = indices[i];
        const iB = indices[i+1];
        const iC = indices[i+2];

        vA.fromBufferAttribute(positions, iA);
        vB.fromBufferAttribute(positions, iB);
        vC.fromBufferAttribute(positions, iC);
        
        THREE.Triangle.getNormal(vA, vB, vC, faceNormal);
        if (faceNormal.y < slopeThreshold) {
            debugStats.rejectedSlope++;
            continue;
        }
        if (vA.y <= 0 && vB.y <= 0 && vC.y <= 0) {
            debugStats.rejectedSubmerged++;
            continue;
        }

        centroid.copy(vA).add(vB).add(vC).divideScalar(3);
        centroid2D.set(centroid.x, centroid.z);
        
        if (!this.isPointInPolygon(centroid2D, outerBoundary)) {
            debugStats.rejectedOutsideBand++;
            continue;
        }

        if (this.isPointInPolygon(centroid2D, innerBoundary)) {
            debugStats.rejectedInsideBand++;
            continue;
        }
        
        debugStats.accepted++;
        const area = triangle.set(vA, vB, vC).getArea();
        validFaces.push({
            vA: vA.clone(), vB: vB.clone(), vC: vC.clone(),
            normal: faceNormal.clone(), area
        });
        totalArea += area;
    }

    const density = parseFloat(densityInput.value);
    let numInstances = Math.floor(totalArea / 100 * density);

    const maxFoliageCountVal = maxCountInput.value;
    if (maxFoliageCountVal) {
        const maxCount = parseInt(maxFoliageCountVal, 10);
        if (!isNaN(maxCount) && maxCount >= 0) {
            numInstances = Math.min(numInstances, maxCount);
        }
    }
    
    if (numInstances === 0 || validFaces.length === 0) {
        if (outputElement) {
            const message = `No ${debugLabel.toLowerCase()} generated.
Reason: No valid surface area found for placement.

Current Settings:
- Max Slope Allowed:  ${maxSlopeDegrees.toFixed(1).padStart(7)}°
- ${debugLabel} Band Width: ${foliageBandWidth.toFixed(1).padStart(7)} units

Debug Stats:
- Total surface faces:    ${String(debugStats.totalFaces).padStart(7)}
- Rejected (too steep):   ${String(debugStats.rejectedSlope).padStart(7)}
- Rejected (underwater):  ${String(debugStats.rejectedSubmerged).padStart(7)}
- Rejected (outside band):${String(debugStats.rejectedOutsideBand).padStart(7)}
- Rejected (inside band): ${String(debugStats.rejectedInsideBand).padStart(7)}
- Accepted faces:         ${String(debugStats.accepted).padStart(7)}
- Calculated valid area:  ${totalArea.toFixed(2).padStart(7)} units²

Suggestion: Try increasing "Max ${debugLabel} Slope" or adjusting parameters.`;
            outputElement.textContent = message;
        }
        return;
    }

    const cdf: { faceIndex: number, cumulativeArea: number }[] = [];
    let cumulativeArea = 0;
    for(let i = 0; i < validFaces.length; i++) {
        cumulativeArea += validFaces[i].area;
        cdf.push({faceIndex: i, cumulativeArea});
    }

    const up = new THREE.Vector3(0, 1, 0);
    const pivotPoints: THREE.Vector3[] = [];
    const baseScale = parseFloat(scaleInput.value);

    for (let i = 0; i < numInstances; i++) {
        const randomArea = Math.random() * totalArea;
        const foundCdf = cdf.find(item => item.cumulativeArea >= randomArea);
        if (!foundCdf) continue;

        const faceData = validFaces[foundCdf.faceIndex];
        
        let u = Math.random();
        let v = Math.random();
        if (u + v > 1) {
            u = 1 - u;
            v = 1 - v;
        }
        const w = 1 - u - v;

        const point = new THREE.Vector3();
        point.addScaledVector(faceData.vA, u);
        point.addScaledVector(faceData.vB, v);
        point.addScaledVector(faceData.vC, w);
        
        pivotPoints.push(point.clone());

        const modelData = models[i % models.length];
        const instance = modelData.model.clone(true);

        instance.position.copy(point);
        
        const quaternion = new THREE.Quaternion().setFromUnitVectors(up, faceData.normal);
        instance.quaternion.copy(quaternion);
        
        instance.rotateY(Math.random() * Math.PI * 2);

        const randomVariation = THREE.MathUtils.randFloat(0.8, 1.2);
        const finalScale = baseScale * randomVariation;
        instance.scale.set(finalScale, finalScale, finalScale);

        this.foliageGroup.add(instance);
    }
    
    if (outputElement && pivotPoints.length > 0) {
        const coordinatesText = pivotPoints.map((p, index) => {
            const x = p.x.toFixed(2);
            const y = p.y.toFixed(2);
            const z = p.z.toFixed(2);
            return `${(index + 1).toString().padStart(4, ' ')}: (${x.padStart(7, ' ')}, ${y.padStart(7, ' ')}, ${z.padStart(7, ' ')})`;
        }).join('\n');
        outputElement.textContent = `Generated ${pivotPoints.length} ${debugLabel.toLowerCase()} instances.\n` + coordinatesText;
    } else if (outputElement) {
        outputElement.textContent = `No ${debugLabel.toLowerCase()} points generated.`;
    }
  }

  private showLoading(isLoading: boolean, message: string = "Loading...") {
    if (!this.loadingOverlay) return;
    this.loadingOverlay.style.display = isLoading ? 'flex' : 'none';
    if(isLoading) {
      const loadingText = this.loadingOverlay.querySelector('p');
      if (loadingText) {
        loadingText.textContent = message;
      }
    }
  }

  private onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  private animate() {
    requestAnimationFrame(this.animate.bind(this));
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}

new IslandGeneratorApp();