import { PricingRequestForm } from "../PricingRequestForm";

export default function PricingRequestFormExample() {
  return (
    <div className="max-w-5xl">
      <PricingRequestForm
        onSubmit={(data, routes) => console.log("Submit:", data, routes)}
        onCancel={() => console.log("Cancel")}
      />
    </div>
  );
}
