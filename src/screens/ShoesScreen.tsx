import { Footprints } from "lucide-react";
import { useState } from "react";
import { useAppData } from "../data/app-context";
import { formatMiles } from "../utils/format";

export function ShoesScreen() {
  const { data } = useAppData();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const shoes = [...data.shoes].sort(
    (a, b) => Number(!!a.retired) - Number(!!b.retired),
  );
  const selected = shoes.find((shoe) => shoe.id === selectedId) ?? shoes[0];
  const activeCount = shoes.filter((shoe) => !shoe.retired).length;

  return (
    <div className="screen shoes-screen">
      <header className="page-header">
        <div>
          <p className="eyebrow">Running gear</p>
          <h1>Shoes</h1>
          <p>Recorded mileage for your shoes.</p>
        </div>
        {shoes.length > 0 && (
          <span className="local-note">
            {activeCount} active {activeCount === 1 ? "pair" : "pairs"}
          </span>
        )}
      </header>
      {shoes.length === 0 ? (
        <div className="panel shoes-empty">
          <Footprints size={26} aria-hidden="true" />
          <h2>No shoes recorded</h2>
          <p>Shoes added to your running records will appear here.</p>
        </div>
      ) : (
        <div className="shoes-grid">
          <section aria-labelledby="shoe-list-title">
            <h2 id="shoe-list-title">Your shoes</h2>
            <div className="shoe-list">
              {shoes.map((shoe) => (
                <button
                  key={shoe.id}
                  className={
                    shoe.id === selected.id ? "shoe-item selected" : "shoe-item"
                  }
                  aria-pressed={shoe.id === selected.id}
                  onClick={() => setSelectedId(shoe.id)}
                >
                  <Footprints size={19} aria-hidden="true" />
                  <span>
                    <strong>{shoe.name}</strong>
                    <small>
                      {shoe.retired ? "Retired" : "Active"}
                      {shoe.isDefault && " · Default shoe"}
                    </small>
                  </span>
                  <strong>{formatMiles(shoe.mileageMiles)}</strong>
                </button>
              ))}
            </div>
          </section>
          <section
            className="panel shoe-detail"
            aria-labelledby="selected-shoe-title"
          >
            <p className="eyebrow">Selected shoe</p>
            <h2 id="selected-shoe-title">{selected.name}</h2>
            <p>
              {selected.retired ? "Retired" : "Active"}
              {selected.isDefault && " · Default shoe"}
            </p>
            <div className="shoe-mileage">
              <span>Total recorded mileage</span>
              <strong>{formatMiles(selected.mileageMiles)}</strong>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
