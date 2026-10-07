/// <reference types="@types/google.maps" />
import { useState, useEffect, useRef, useCallback, useId, type ChangeEvent, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Input } from "@/components/ui/input";
import { MapPin, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface PlacesAutocompleteProps {
  value: string;
  onChange: (value: string, placeDetails?: PlaceDetails) => void;
  placeholder?: string;
  className?: string;
  "data-testid"?: string;
}

export interface PlaceDetails {
  formattedAddress: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  lat?: number;
  lng?: number;
}

declare global {
  interface Window {
    google: typeof google;
    initGooglePlaces?: () => void;
  }
}

const GOOGLE_SCRIPT_TIMEOUT_MS = 10000;
const PREDICTION_DEBOUNCE_MS = 250;
const DROPDOWN_VIEWPORT_PADDING = 8;
const DROPDOWN_MIN_WIDTH = 280;

interface GooglePlacesLoad {
  promise: Promise<void>;
  script: HTMLScriptElement;
  timeoutId: number;
  callback: () => void;
  settled: boolean;
}

let googlePlacesLoad: GooglePlacesLoad | null = null;

/**
 * There is one script request for the whole page. In particular, do not create
 * one callback queue per component: a failed request must reject every waiter,
 * not leave components waiting forever.
 */
function loadGooglePlacesScript(apiKey: string): Promise<void> {
  if (window.google?.maps?.places) {
    return Promise.resolve();
  }

  if (googlePlacesLoad) {
    return googlePlacesLoad.promise;
  }

  let resolveLoad!: () => void;
  let rejectLoad!: (reason: Error) => void;
  let state: GooglePlacesLoad | null = null;

  const script = document.createElement("script");
  script.async = true;
  script.defer = true;
  script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places&callback=initGooglePlaces`;

  const promise = new Promise<void>((resolve, reject) => {
    resolveLoad = resolve;
    rejectLoad = reject;
  });

  const succeed = () => {
    if (!state || state.settled || googlePlacesLoad !== state) {
      return;
    }

    state.settled = true;
    window.clearTimeout(state.timeoutId);
    script.onerror = null;
    if (window.initGooglePlaces === succeed) {
      delete window.initGooglePlaces;
    }
    resolveLoad();
  };

  const fail = (reason: Error) => {
    if (!state || state.settled || googlePlacesLoad !== state) {
      return;
    }

    state.settled = true;
    window.clearTimeout(state.timeoutId);
    script.onerror = null;
    if (script.parentNode) {
      script.parentNode.removeChild(script);
    }
    if (window.initGooglePlaces === succeed) {
      delete window.initGooglePlaces;
    }
    googlePlacesLoad = null;
    rejectLoad(reason);
  };

  state = {
    promise,
    script,
    timeoutId: 0,
    callback: succeed,
    settled: false,
  };
  googlePlacesLoad = state;

  window.initGooglePlaces = succeed;
  script.onerror = () => fail(new Error("No se pudo cargar Google Places."));
  state.timeoutId = window.setTimeout(
    () => fail(new Error("Google Places tardó demasiado en responder.")),
    GOOGLE_SCRIPT_TIMEOUT_MS,
  );
  document.head.appendChild(script);

  return promise;
}

type LoadStatus = "loading" | "ready" | "unavailable" | "error";

export function PlacesAutocomplete({
  value,
  onChange,
  placeholder = "Ciudad, Estado, País",
  className,
  "data-testid": testId,
}: PlacesAutocompleteProps) {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  const instanceId = useId().replace(/:/g, "");
  const listboxId = `${instanceId}-places-listbox`;
  const helpId = `${instanceId}-places-help`;

  const [loadStatus, setLoadStatus] = useState<LoadStatus>(apiKey ? "loading" : "unavailable");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [predictions, setPredictions] = useState<google.maps.places.AutocompletePrediction[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [inputValue, setInputValue] = useState(value);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 0 });

  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteServiceRef = useRef<google.maps.places.AutocompleteService | null>(null);
  const placesServiceRef = useRef<google.maps.places.PlacesService | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputValueRef = useRef(value);
  const predictionDebounceRef = useRef<any>(null);
  const predictionRequestIdRef = useRef(0);
  const selectionRequestIdRef = useRef(0);
  const mountedRef = useRef(false);

  const clearPredictionDebounce = useCallback(() => {
    if (predictionDebounceRef.current !== null) {
      window.clearTimeout(predictionDebounceRef.current);
      predictionDebounceRef.current = null;
    }
  }, []);

  const requestPredictions = useCallback((input: string) => {
    const requestId = ++predictionRequestIdRef.current;
    clearPredictionDebounce();

    if (loadStatus !== "ready" || !autocompleteServiceRef.current || input.trim().length < 2) {
      setPredictions([]);
      setActiveIndex(-1);
      setIsOpen(false);
      return;
    }

    const service = autocompleteServiceRef.current;
    predictionDebounceRef.current = window.setTimeout(() => {
      predictionDebounceRef.current = null;

      if (
        !mountedRef.current ||
        requestId !== predictionRequestIdRef.current ||
        inputValueRef.current !== input
      ) {
        return;
      }

      service.getPlacePredictions(
        {
          input,
          // Freight endpoints need cities; restricting this to states would
          // return unusable endpoints when someone types a state name.
          types: ["(cities)"],
        },
        (results, status) => {
          if (
            !mountedRef.current ||
            requestId !== predictionRequestIdRef.current ||
            inputValueRef.current !== input
          ) {
            return;
          }

          const placesStatus = window.google?.maps?.places?.PlacesServiceStatus;
          if (status === placesStatus?.OK && results && results.length > 0) {
            setPredictions(results);
            setActiveIndex(-1);
            setIsOpen(true);
          } else {
            setPredictions([]);
            setActiveIndex(-1);
            setIsOpen(false);
          }
        },
      );
    }, PREDICTION_DEBOUNCE_MS);
  }, [clearPredictionDebounce, loadStatus]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      predictionRequestIdRef.current += 1;
      selectionRequestIdRef.current += 1;
      clearPredictionDebounce();
    };
  }, [clearPredictionDebounce]);

  useEffect(() => {
    if (value === inputValueRef.current) {
      return;
    }

    inputValueRef.current = value;
    setInputValue(value);
    predictionRequestIdRef.current += 1;
    selectionRequestIdRef.current += 1;
    clearPredictionDebounce();
    setPredictions([]);
    setActiveIndex(-1);
    setIsOpen(false);
  }, [clearPredictionDebounce, value]);

  useEffect(() => {
    let active = true;

    if (!apiKey) {
      autocompleteServiceRef.current = null;
      placesServiceRef.current = null;
      setLoadStatus("unavailable");
      setLoadError(null);
      return () => {
        active = false;
      };
    }

    setLoadStatus("loading");
    setLoadError(null);

    loadGooglePlacesScript(apiKey)
      .then(() => {
        if (!active || !mountedRef.current) {
          return;
        }

        autocompleteServiceRef.current = new window.google.maps.places.AutocompleteService();
        const serviceContainer = document.createElement("div");
        placesServiceRef.current = new window.google.maps.places.PlacesService(serviceContainer);
        setLoadStatus("ready");
      })
      .catch((error: unknown) => {
        if (!active || !mountedRef.current) {
          return;
        }

        autocompleteServiceRef.current = null;
        placesServiceRef.current = null;
        setLoadStatus("error");
        setLoadError(error instanceof Error ? error.message : "Error desconocido.");
      });

    return () => {
      active = false;
    };
  }, [apiKey, retryAttempt]);

  useEffect(() => {
    if (loadStatus === "ready") {
      requestPredictions(inputValueRef.current);
    }
  }, [loadStatus, requestPredictions]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      if (target.closest("[data-places-portal]")) {
        return;
      }
      if (containerRef.current && !containerRef.current.contains(target)) {
        predictionRequestIdRef.current += 1;
        clearPredictionDebounce();
        setIsOpen(false);
        setActiveIndex(-1);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [clearPredictionDebounce]);

  const updateDropdownPosition = useCallback(() => {
    if (!inputRef.current) {
      return;
    }

    const rect = inputRef.current.getBoundingClientRect();
    const viewportWidth = Math.max(0, window.innerWidth);
    const maximumWidth = Math.max(0, viewportWidth - DROPDOWN_VIEWPORT_PADDING * 2);
    const width = Math.min(Math.max(rect.width, DROPDOWN_MIN_WIDTH), maximumWidth);
    const left = Math.min(
      Math.max(rect.left, DROPDOWN_VIEWPORT_PADDING),
      Math.max(DROPDOWN_VIEWPORT_PADDING, viewportWidth - width - DROPDOWN_VIEWPORT_PADDING),
    );

    // `position: fixed` uses viewport coordinates. Do not add scroll offsets.
    setDropdownPosition({
      top: rect.bottom,
      left,
      width,
    });
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    updateDropdownPosition();
    window.addEventListener("scroll", updateDropdownPosition, true);
    window.addEventListener("resize", updateDropdownPosition);
    return () => {
      window.removeEventListener("scroll", updateDropdownPosition, true);
      window.removeEventListener("resize", updateDropdownPosition);
    };
  }, [isOpen, updateDropdownPosition]);

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const newValue = event.target.value;
    inputValueRef.current = newValue;
    setInputValue(newValue);
    selectionRequestIdRef.current += 1;
    onChange(newValue);
    requestPredictions(newValue);
  };

  const handleSelectPrediction = useCallback((prediction: google.maps.places.AutocompletePrediction) => {
    const selectionId = ++selectionRequestIdRef.current;
    predictionRequestIdRef.current += 1;
    clearPredictionDebounce();
    setPredictions([]);
    setActiveIndex(-1);
    setIsOpen(false);

    inputValueRef.current = prediction.description;
    setInputValue(prediction.description);
    onChange(prediction.description);

    const service = placesServiceRef.current;
    if (!service) {
      return;
    }

    service.getDetails(
      {
        placeId: prediction.place_id,
        fields: ["formatted_address", "address_components", "geometry"],
      },
      (place, status) => {
        if (!mountedRef.current || selectionId !== selectionRequestIdRef.current) {
          return;
        }

        const placesStatus = window.google?.maps?.places?.PlacesServiceStatus;
        if (status === placesStatus?.OK && place) {
          const details: PlaceDetails = {
            formattedAddress: place.formatted_address || prediction.description,
          };

          if (place.address_components) {
            for (const component of place.address_components) {
              if (component.types.includes("locality")) {
                details.city = component.long_name;
              }
              if (component.types.includes("administrative_area_level_1")) {
                details.state = component.short_name;
              }
              if (component.types.includes("country")) {
                details.country = component.long_name;
              }
              if (component.types.includes("postal_code")) {
                details.postalCode = component.long_name;
              }
            }
          }

          if (place.geometry?.location) {
            details.lat = place.geometry.location.lat();
            details.lng = place.geometry.location.lng();
          }

          const displayValue = details.city && details.state
            ? `${details.city}, ${details.state}${details.country && details.country !== "Mexico" ? `, ${details.country}` : ""}`
            : prediction.description;

          inputValueRef.current = displayValue;
          setInputValue(displayValue);
          onChange(displayValue, details);
        } else {
          inputValueRef.current = prediction.description;
          setInputValue(prediction.description);
          onChange(prediction.description);
        }
        setIsOpen(false);
      },
    );
  }, [clearPredictionDebounce, onChange]);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      if (predictions.length === 0) {
        return;
      }
      event.preventDefault();
      setIsOpen(true);
      setActiveIndex((current) => (current < predictions.length - 1 ? current + 1 : 0));
      return;
    }

    if (event.key === "ArrowUp") {
      if (predictions.length === 0) {
        return;
      }
      event.preventDefault();
      setIsOpen(true);
      setActiveIndex((current) => (current > 0 ? current - 1 : predictions.length - 1));
      return;
    }

    if (event.key === "Enter" && isOpen && activeIndex >= 0 && predictions[activeIndex]) {
      event.preventDefault();
      handleSelectPrediction(predictions[activeIndex]);
      return;
    }

    if (event.key === "Escape" && isOpen) {
      event.preventDefault();
      predictionRequestIdRef.current += 1;
      clearPredictionDebounce();
      setIsOpen(false);
      setActiveIndex(-1);
    }
  };

  const handleRetry = () => {
    setLoadError(null);
    setLoadStatus("loading");
    setRetryAttempt((attempt) => attempt + 1);
  };

  const helpText = loadStatus === "unavailable"
    ? "Las sugerencias de ciudades no están disponibles porque falta VITE_GOOGLE_MAPS_API_KEY. Puedes escribir la ubicación manualmente."
    : loadStatus === "error"
      ? `No se pudieron cargar las sugerencias de Google Maps${loadError ? ` (${loadError})` : ""}. Puedes escribir la ubicación manualmente.`
      : null;

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Input
          ref={inputRef}
          value={inputValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => predictions.length > 0 && setIsOpen(true)}
          placeholder={placeholder}
          className={cn("pr-8", className)}
          data-testid={testId}
          role="combobox"
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-expanded={isOpen && predictions.length > 0}
          aria-controls={listboxId}
          aria-activedescendant={
            isOpen && activeIndex >= 0 ? `${instanceId}-prediction-${activeIndex}` : undefined
          }
          aria-describedby={helpText ? helpId : undefined}
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground">
          {loadStatus === "loading" ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <MapPin className="h-4 w-4" aria-hidden="true" />
          )}
        </div>
      </div>

      {helpText && (
        <div
          id={helpId}
          className="mt-1 text-xs text-muted-foreground"
          role={loadStatus === "error" ? "alert" : undefined}
        >
          <span>{helpText}</span>
          {loadStatus === "error" && (
            <button
              type="button"
              className="ml-1 underline underline-offset-2 hover:text-foreground"
              onClick={handleRetry}
            >
              Reintentar
            </button>
          )}
        </div>
      )}

      {isOpen && predictions.length > 0 && typeof document !== "undefined" && createPortal(
        <div
          id={listboxId}
          data-places-portal
          role="listbox"
          className="fixed z-[9999] bg-popover border rounded-md shadow-lg max-h-60 overflow-auto"
          style={{
            top: dropdownPosition.top,
            left: dropdownPosition.left,
            width: dropdownPosition.width,
          }}
        >
          {predictions.map((prediction, index) => (
            <button
              key={prediction.place_id}
              id={`${instanceId}-prediction-${index}`}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              className={cn(
                "w-full px-3 py-2 text-left text-sm hover-elevate flex items-center gap-2",
                index === activeIndex && "bg-accent",
              )}
              onClick={() => handleSelectPrediction(prediction)}
              data-testid={`suggestion-${prediction.place_id}`}
            >
              <MapPin className="h-3 w-3 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="truncate">{prediction.description}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}