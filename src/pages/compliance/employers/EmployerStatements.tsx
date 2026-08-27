import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { FileText, Download, Calendar, DollarSign, Search, Filter, Loader2 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchEmployerStatementSummaries } from "@/services/complianceDataService";

export default function EmployerStatements() {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState("");

  const { data: statements = [], isLoading } = useQuery({
    queryKey: ['ce_employer_statements'],
    queryFn: fetchEmployerStatementSummaries,
  });

  const filteredStatements = statements.filter((statement: any) =>
    statement.employerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    statement.employerId.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'XCD' }).format(amount);
  };

  const totalOutstanding = statements.reduce((sum: number, s: any) => sum + (s.outstanding || 0), 0);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Employer Statements</h1>
          <p className="text-muted-foreground">Generate and view employer compliance statements</p>
        </div>
        <Button className="gap-2"><FileText className="h-4 w-4" />Generate New Statement</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card><CardContent className="pt-6"><div className="text-2xl font-bold text-foreground">{formatCurrency(totalOutstanding)}</div><p className="text-sm text-muted-foreground">Total Outstanding</p></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="text-2xl font-bold text-foreground">{statements.length}</div><p className="text-sm text-muted-foreground">Employers</p></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="text-2xl font-bold text-foreground">{statements.filter((s: any) => s.complianceStatus === 'non_compliant').length}</div><p className="text-sm text-muted-foreground">Non-Compliant</p></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="text-2xl font-bold text-foreground">{statements.filter((s: any) => s.complianceStatus === 'compliant').length}</div><p className="text-sm text-muted-foreground">Compliant</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Recent Statements</CardTitle></CardHeader>
        <CardContent>
          <div className="flex gap-4 mb-6">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search by employer name or ID..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-10" />
              </div>
            </div>
            <Button variant="outline" className="gap-2"><Filter className="h-4 w-4" />Filters</Button>
          </div>

          {filteredStatements.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No statements found</div>
          ) : (
            <div className="space-y-4">
              {filteredStatements.map((statement: any) => (
                <div key={statement.id} className="border rounded-lg p-4 hover:border-primary/50 transition-colors">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-foreground">{statement.employerName}</h3>
                        <Badge variant="outline" className="text-xs">{statement.employerId}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">Statement as of {statement.asOfDate}</p>
                    </div>
                    <Badge variant={statement.complianceStatus === "compliant" ? "default" : "destructive"}>
                      {statement.complianceStatus.toUpperCase()}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4 p-3 bg-muted/50 rounded-lg">
                    <div><p className="text-xs text-muted-foreground mb-1">Total Due</p><p className="font-semibold text-foreground">{formatCurrency(statement.totalDue)}</p></div>
                    <div><p className="text-xs text-muted-foreground mb-1">Total Paid</p><p className="font-semibold text-foreground">{formatCurrency(statement.totalPaid)}</p></div>
                    <div><p className="text-xs text-muted-foreground mb-1">Outstanding</p><p className="font-semibold text-destructive">{formatCurrency(statement.outstanding)}</p></div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => navigate(`/compliance/field/employer-statement/${statement.employerId}`)}>View Full Statement</Button>
                    <Button size="sm" variant="outline" className="gap-2"><Download className="h-4 w-4" />Download PDF</Button>
                    <Button size="sm" variant="outline" className="gap-2"><Calendar className="h-4 w-4" />Generate As Of Date</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
