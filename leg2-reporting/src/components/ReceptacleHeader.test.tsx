import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReceptacleHeader } from "@/components/ReceptacleHeader";
import type { EdiDetail } from "@/lib/supabase";

const detail: EdiDetail = {
  s9code: "INBOMAJPKWSAAUY60597001100039",
  origin_office: "INBOMA", destination_office: "JPKWSA",
  mail_category: "U", mail_subclass: "A", rec_no: "39",
  gross_weight: "21.5", items: "120",
};

describe("ReceptacleHeader", () => {
  it("shows the code and all edi_details fields", () => {
    render(<ReceptacleHeader s9={detail.s9code} detail={detail} />);
    expect(screen.getByText(detail.s9code)).toBeInTheDocument();
    expect(screen.getByText("120")).toBeInTheDocument();
    expect(screen.getByText("21.5")).toBeInTheDocument();
    expect(screen.getByText("INBOMA")).toBeInTheDocument();
  });

  it("falls back to S9-derived origin/destination when no detail row", () => {
    render(<ReceptacleHeader s9="INBOMAJPKWSAAUY60597001100039" detail={null} />);
    expect(screen.getByText(/No receptacle detail available/i)).toBeInTheDocument();
    expect(screen.getByText("INBOMA")).toBeInTheDocument();
    expect(screen.getByText("JPKWSA")).toBeInTheDocument();
  });
});
